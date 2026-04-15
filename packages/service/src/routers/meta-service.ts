import path from 'node:path';
import { matchesPattern } from 'fs-context';
import type { IContextService } from '@ai-team/api-client';
import { loadAllInstructionFiles, loadAgentSkillFile } from '@ai-team/infrastructure';
import type { AgentManager, AgentTool, SkillManager } from '@ai-team/infrastructure';
import { toolKey, type LlmToolDefinition, type ToolManager } from '../tools/tool-manager.js';
import type { IMcpGateway } from '../orchestrator/pipeline.js';
import type { SessionManager } from '../session-manager.js';
import { NotFoundError } from '../http-errors.js';

export interface ContextEstimateSegment {
  label: string;
  key: string;
  chars: number;
}

export interface ContextEstimateInstructionFile {
  path: string;
  label: string;
  chars: number;
  applyTo?: string;
}

export interface ContextEstimateMessage {
  role: 'user' | 'assistant';
  preview: string;
  chars: number;
  toolCallCount: number;
  toolChars: number;
  archived: boolean;
}

export interface ContextEstimateSkill {
  name: string;
  skillPath: string;
  chars: number;
  paused: boolean;
  isSessionSkill: boolean;
}

export interface ContextEstimateTool {
  name: string;
  description: string;
  chars: number;
}

export interface ContextEstimateResponse {
  agentId: string;
  sessionId?: string;
  segments: ContextEstimateSegment[];
  totalChars: number;
  instructionFiles: ContextEstimateInstructionFile[];
  messages: ContextEstimateMessage[];
  sessionSkills: ContextEstimateSkill[];
  tools: ContextEstimateTool[];
}

export class MetaService implements IContextService {
  private readonly toolCache = new Map<
    string,
    { tools: ContextEstimateTool[]; chars: number; at: number }
  >();
  private static readonly TOOL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly agentManager: AgentManager,
    private readonly sessionManager: SessionManager,
    private readonly skillManager: SkillManager,
    private readonly toolManager: ToolManager,
    private readonly mcpGateway?: IMcpGateway
  ) {}

  private async getToolsForAgent(
    agentId: string,
    agent: Parameters<ToolManager['describeAll']>[0]
  ): Promise<{ tools: ContextEstimateTool[]; chars: number }> {
    const cached = this.toolCache.get(agentId);
    if (cached && Date.now() - cached.at < MetaService.TOOL_CACHE_TTL_MS) {
      return cached;
    }

    const staticTools = this.toolManager.getForAgent(agent);
    const discoverMcpTools = (this.mcpGateway as { discover?: () => Promise<AgentTool[]> })
      ?.discover;
    const mcpTools =
      typeof discoverMcpTools === 'function'
        ? await discoverMcpTools.call(this.mcpGateway)
        : ([] as AgentTool[]);

    const defsByName = new Map<string, LlmToolDefinition>();
    for (const tool of [...staticTools, ...mcpTools]) {
      const def = this.toToolDefinition(tool);
      defsByName.set(def.name, def);
    }

    const toolDefs = [...defsByName.values()];
    const tools: ContextEstimateTool[] = toolDefs.map((t) => ({
      name: t.name,
      description: t.description,
      chars: JSON.stringify({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters ?? {} },
      }).length,
    }));
    // Include the tool policy system message that llm-invoke.ts injects when tools are present.
    const toolPolicyChars =
      tools.length > 0
        ? (
            `Tool-calling is available. Registered tools: ${tools.map((t) => t.name).join(', ')}. ` +
            'Do not invent tool names. ' +
            'If you need clarification or missing input from the developer, call com_ask instead of guessing. ' +
            'If the developer asks about what tools you can use, what files you can read/write, or access/permissions, call a relevant introspection tool (for example tool_list, tool_can_i, fs_who_can) before answering. ' +
            'If the developer asks to list or show visible/readable files (or file tree), call fs_tree on path "." (or requested path) first, then explain results.'
          ).length
        : 0;
    const chars = tools.reduce((s, t) => s + t.chars, 0) + toolPolicyChars;
    this.toolCache.set(agentId, { tools, chars, at: Date.now() });
    return { tools, chars };
  }

  async getContextEstimate(agentId: string, query?: { sessionId?: string }): Promise<unknown> {
    const agent = await this.agentManager.getAgentAsync(agentId);
    if (!agent) throw new NotFoundError(`Agent '${agentId}' not found`);

    const workspaceRoot = this.agentManager.workspaceRoot;
    const sessionId = query?.sessionId;

    let messages: ContextEstimateMessage[] = [];
    let sessionSkills: ContextEstimateSkill[] = [];
    let writtenFiles: string[] = [];

    if (sessionId) {
      const [sessionMessages, loadedSessionSkills] = await Promise.all([
        this.sessionManager.getSessionMessages(sessionId),
        this.loadSessionSkills(sessionId, workspaceRoot),
      ]);
      messages = this.mapSessionMessages(sessionMessages);
      sessionSkills = loadedSessionSkills;
      writtenFiles = this.extractWrittenFiles(sessionMessages, workspaceRoot);
    }

    const [instructionFiles, allAgents, resolvedSkills] = await Promise.all([
      this.loadInstructionFiles(workspaceRoot, agent, writtenFiles),
      this.agentManager.getAllAgentsAsync(),
      this.skillManager.resolveSkillsForAgent(agent),
    ]);
    const { tools, chars: toolChars } = await this.getToolsForAgent(agentId, agent);

    const segments = this.buildSystemPromptSegments(
      agent,
      agentId,
      instructionFiles,
      allAgents,
      resolvedSkills,
      toolChars
    );

    if (sessionId) {
      this.appendSessionSegments(segments, messages, sessionSkills);
    }

    const totalChars = segments.reduce((s, x) => s + x.chars, 0);
    const response: ContextEstimateResponse = {
      agentId: agent.id,
      segments,
      totalChars,
      instructionFiles,
      messages,
      sessionSkills,
      tools,
    };
    if (sessionId) response.sessionId = sessionId;
    return response;
  }

  private toToolDefinition(tool: AgentTool): LlmToolDefinition {
    const key = toolKey(tool);
    const fromManager = this.toolManager.toSchema(key);
    if (fromManager) return fromManager;
    return {
      name: key,
      description: tool.description,
      parameters: zodSchemaToJsonSchema(tool.parameters),
    };
  }

  private buildSystemPromptSegments(
    agent: Awaited<ReturnType<AgentManager['getAgentAsync']>> & object,
    agentId: string,
    instructionFiles: ContextEstimateInstructionFile[],
    allAgents: Awaited<ReturnType<AgentManager['getAllAgentsAsync']>>,
    resolvedSkills: Awaited<ReturnType<SkillManager['resolveSkillsForAgent']>>,
    toolChars: number = 0
  ): ContextEstimateSegment[] {
    const identityChars = this.estimateIdentityChars(agent);
    const bioChars = (agent as Record<string, unknown>).markdown
      ? String((agent as Record<string, unknown>).markdown).trim().length
      : 0;
    const skillChars = resolvedSkills.skills.reduce(
      (sum, s) => sum + (s.instructions?.length ?? 0),
      0
    );
    const instructionChars = instructionFiles.reduce((sum, f) => sum + f.chars, 0);
    const teamChars =
      allAgents
        .filter((a) => a.id !== agentId)
        .map((a) => `- ${a.name} — ${a.role}`)
        .join('\n').length + 20;

    const segments: ContextEstimateSegment[] = [
      { key: 'identity', label: 'Identity & Personality', chars: identityChars },
    ];
    if (bioChars > 0) segments.push({ key: 'bio', label: 'Bio', chars: bioChars });
    if (skillChars > 0) segments.push({ key: 'skills', label: 'Role Skills', chars: skillChars });
    if (instructionChars > 0)
      segments.push({
        key: 'instructions',
        label: 'Workspace Instructions',
        chars: instructionChars,
      });
    if (teamChars > 20) segments.push({ key: 'team', label: 'Team Roster', chars: teamChars });
    if (toolChars > 0) segments.push({ key: 'tools', label: 'Tool Definitions', chars: toolChars });
    return segments;
  }

  private estimateIdentityChars(agent: Record<string, unknown>): number {
    const parts = [
      `You are ${String(agent.name)}, a virtual AI team member.`,
      `Your role: ${String(agent.role)}`,
    ];
    if (agent.reportsTo) parts.push(`You report to ${JSON.stringify(agent.reportsTo)}.`);
    const p = agent.personality as Record<string, unknown> | undefined;
    if (p?.communication_style)
      parts.push(`Communication style: ${JSON.stringify(p.communication_style)}`);
    if (p?.expertise_level) parts.push(`Expertise level: ${JSON.stringify(p.expertise_level)}`);
    const cliBlock =
      '## CLI Commands Available To The User\nThe developer can run these in-chat commands: chat, list, hire, history, portfolio, graph, overview, run, help, exit.\nHANDOFF: <name-or-role> | <message>.\nStay in character. Be concise and helpful.';
    return parts.join('\n').length + cliBlock.length;
  }

  private async loadInstructionFiles(
    workspaceRoot: string,
    agent: Awaited<ReturnType<AgentManager['getAgentAsync']>> & object,
    writtenFiles: string[]
  ): Promise<ContextEstimateInstructionFile[]> {
    try {
      if (writtenFiles.length === 0) {
        return [];
      }

      const writePatterns = (
        (agent as { permissions?: { write?: string[] } }).permissions?.write ?? []
      )
        .map((p) => String(p).trim())
        .filter(Boolean);

      if (writePatterns.length === 0) {
        return [];
      }

      const files = await loadAllInstructionFiles(workspaceRoot);
      return files
        .filter((f) => f.instructions?.trim())
        .filter((f) => this.isInstructionRelevant(f.applyTo, writePatterns, writtenFiles))
        .map((f) => ({
          path: path.relative(workspaceRoot, f.filePath).replaceAll('\\', '/'),
          label: path.basename(f.filePath),
          chars: f.instructions.length,
          applyTo: f.applyTo,
        }));
    } catch {
      return [];
    }
  }

  private mapSessionMessages(
    sessionMessages: Array<{
      archived?: boolean;
      isHuman?: boolean;
      content: string;
      tool_calls?: Array<{
        tool?: string;
        params?: unknown;
        result?: unknown;
        resultLlm?: string;
      }>;
    }>
  ): ContextEstimateMessage[] {
    return sessionMessages
      .filter((m) => !m.archived)
      .map((msg) => {
        const toolCallCount = msg.tool_calls?.length ?? 0;
        const toolChars = this.sumToolResultChars(msg.tool_calls ?? []);
        return {
          role: msg.isHuman ? ('user' as const) : ('assistant' as const),
          preview: msg.content.slice(0, 120),
          chars: msg.content.length,
          toolCallCount,
          toolChars,
          archived: false,
        };
      });
  }

  private extractWrittenFiles(
    sessionMessages: Array<{
      archived?: boolean;
      tool_calls?: Array<{ tool?: string; params?: unknown }>;
    }>,
    workspaceRoot: string
  ): string[] {
    const writeToolNames = new Set([
      'fs_write_file',
      'fs_create',
      'fs_delete_path',
      'fs_mkdir',
      'fs_apply_patch',
      'fs_edit',
      'fs_patch',
      'fs_multiedit',
    ]);

    const result = new Set<string>();
    for (const message of sessionMessages) {
      if (message.archived) continue;
      for (const call of message.tool_calls ?? []) {
        if (!call?.tool || !writeToolNames.has(call.tool)) continue;
        for (const filePath of this.extractPathsFromToolParams(call.params)) {
          const normalized = this.toWorkspaceRelativePath(filePath, workspaceRoot);
          if (normalized) result.add(normalized);
        }
      }
    }
    return [...result];
  }

  private extractPathsFromToolParams(params: unknown): string[] {
    const paths: string[] = [];

    const collect = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      const obj = value as Record<string, unknown>;

      for (const key of ['filePath', 'path', 'targetPath', 'oldPath', 'newPath']) {
        const candidate = obj[key];
        if (typeof candidate === 'string' && candidate.trim()) {
          paths.push(candidate.trim());
        }
      }

      const changes = obj.changes;
      if (Array.isArray(changes)) {
        for (const ch of changes) collect(ch);
      }

      const edits = obj.edits;
      if (Array.isArray(edits)) {
        for (const edit of edits) collect(edit);
      }
    };

    collect(params);
    return paths;
  }

  private toWorkspaceRelativePath(filePath: string, workspaceRoot: string): string | undefined {
    const trimmed = filePath.trim();
    if (!trimmed) return undefined;

    const maybeAbsolute = path.isAbsolute(trimmed) ? trimmed : path.join(workspaceRoot, trimmed);
    const relative = path.relative(workspaceRoot, maybeAbsolute).replaceAll('\\', '/');

    if (!relative || relative === '.' || relative.startsWith('..')) {
      const direct = trimmed.replaceAll('\\', '/').replace(/^\.\//, '');
      return direct.length > 0 ? direct : undefined;
    }

    return relative.replace(/^\.\//, '');
  }

  private isInstructionRelevant(
    applyToRaw: string,
    writePatterns: string[],
    writtenFiles: string[]
  ): boolean {
    const applyToPatterns = applyToRaw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);

    if (applyToPatterns.length === 0) {
      return false;
    }

    return writtenFiles.some((filePath) => {
      const inInstructionScope = applyToPatterns.some((pattern) =>
        matchesPattern(filePath, pattern)
      );
      if (!inInstructionScope) return false;
      return writePatterns.some((pattern) => matchesPattern(filePath, pattern));
    });
  }

  private sumToolResultChars(
    toolCalls: Array<{ tool?: string; params?: unknown; result?: unknown; resultLlm?: string }>
  ): number {
    return toolCalls.reduce((sum, tc) => {
      const toolNameChars = tc.tool ? tc.tool.length : 0;
      const paramsChars =
        tc.params === undefined
          ? 0
          : (typeof tc.params === 'string' ? tc.params : JSON.stringify(tc.params)).length;
      const resultContent = tc.resultLlm ?? tc.result;
      const resultChars =
        resultContent === undefined
          ? 0
          : (typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent))
              .length;
      return sum + toolNameChars + paramsChars + resultChars;
    }, 0);
  }

  private async loadSessionSkills(
    sessionId: string,
    workspaceRoot: string
  ): Promise<ContextEstimateSkill[]> {
    const storedSkills = await this.sessionManager.getSessionSkills(sessionId);
    const results: ContextEstimateSkill[] = [];
    for (const sk of storedSkills) {
      let chars = 0;
      let skillName = sk.skillPath;
      try {
        const fullPath = path.join(workspaceRoot, sk.skillPath);
        const file = await loadAgentSkillFile(fullPath);
        chars = file.instructions?.length ?? 0;
        skillName = file.name ?? skillName;
      } catch {
        // ignore load failure
      }
      results.push({
        name: skillName,
        skillPath: sk.skillPath,
        chars,
        paused: sk.paused,
        isSessionSkill: true,
      });
    }
    return results;
  }

  private appendSessionSegments(
    segments: ContextEstimateSegment[],
    messages: ContextEstimateMessage[],
    sessionSkills: ContextEstimateSkill[]
  ): void {
    const activeSkillChars = sessionSkills
      .filter((s) => !s.paused)
      .reduce((sum, s) => sum + s.chars, 0);
    if (activeSkillChars > 0)
      segments.push({ key: 'session_skills', label: 'Session Skills', chars: activeSkillChars });
    const msgTextChars = messages.reduce((sum, m) => sum + m.chars, 0);
    const toolResultChars = messages.reduce((sum, m) => sum + m.toolChars, 0);
    if (msgTextChars > 0)
      segments.push({ key: 'messages', label: 'Chat Messages', chars: msgTextChars });
    if (toolResultChars > 0)
      segments.push({ key: 'tool_results', label: 'Tool Results', chars: toolResultChars });
  }
}

function zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && typeof (schema as any).toJSONSchema === 'function') {
    return (schema as any).toJSONSchema() as Record<string, unknown>;
  }
  return { type: 'object', properties: {}, additionalProperties: true };
}
