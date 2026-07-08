import path from 'node:path';
import { matchesPattern } from 'fs-context';
import type {
  IContextService,
  IPlanningService,
  WorkflowDefinitionApiResponse,
} from '@ai-team/api-contracts';
import type { IAgentManager, ICommand, IAgentDocumentStorage, ISkillManager } from '@ai-team/core';
import { ToolIdentity, type LlmToolDefinition, type ToolManager } from '../tools/tool-manager.js';
import { ZodSchemaTools } from '../utils/zod-schema.js';
import type { IMcpGateway } from '../orchestrator/pipeline.js';
import type { SessionManager } from '../session-manager.js';
import { NotFoundError } from '@ai-team/core';
import {
  getWorkflowDefinitionResolvers,
  type WorkflowDefinitionResolver,
} from '../workflow/index.js';

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
  toolRawChars: number;
  toolSavedChars: number;
  compactedToolCallCount: number;
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

export interface ContextEstimateNote {
  id: string;
  title: string;
  sessionId?: string;
  preview: string;
  chars: number;
  source: 'compacted' | 'content';
}

export interface ContextEstimateResponse {
  agentId: string;
  sessionId?: string;
  segments: ContextEstimateSegment[];
  totalChars: number;
  instructionFiles: ContextEstimateInstructionFile[];
  messages: ContextEstimateMessage[];
  notes: ContextEstimateNote[];
  plans: Array<{ id: string; title: string; chars: number }>;
  tasks: Array<{ id: string; title: string; chars: number; status?: string }>;
  todos: Array<{ id: string; content: string; chars: number; done: boolean }>;
  sessionSkills: ContextEstimateSkill[];
  tools: ContextEstimateTool[];
}

export class MetaService implements IContextService {
  private readonly toolCache = new Map<
    string,
    { tools: ContextEstimateTool[]; chars: number; at: number }
  >();
  private static readonly TOOL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly schemaTools = new ZodSchemaTools();

  private readonly workflowDefinitionResolvers: Record<string, WorkflowDefinitionResolver> =
    getWorkflowDefinitionResolvers();

  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly sessionManager: SessionManager,
    private readonly skillManager: ISkillManager,
    private readonly toolManager: ToolManager,
    private readonly agentDocumentStorage: IAgentDocumentStorage,
    private readonly mcpGateway?: IMcpGateway,
    private readonly planningService?: IPlanningService
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
    const discoverMcpTools = (this.mcpGateway as { discover?: () => Promise<ICommand[]> })
      ?.discover;
    const mcpTools =
      typeof discoverMcpTools === 'function'
        ? await discoverMcpTools.call(this.mcpGateway)
        : ([] as ICommand[]);

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

    const workspaceRoot = this.workspaceRoot;
    const sessionId = query?.sessionId;

    let messages: ContextEstimateMessage[] = [];
    let notes: ContextEstimateNote[] = [];
    let plans: Array<{ id: string; title: string; chars: number }> = [];
    let tasks: Array<{ id: string; title: string; chars: number; status?: string }> = [];
    let todos: Array<{ id: string; content: string; chars: number; done: boolean }> = [];
    let sessionSkills: ContextEstimateSkill[] = [];
    let writtenFiles: string[] = [];

    if (sessionId) {
      const [sessionMessages, loadedSessionSkills] = await Promise.all([
        this.sessionManager.getSessionMessages(sessionId),
        this.loadSessionSkills(sessionId, workspaceRoot),
      ]);
      messages = this.mapSessionMessages(sessionMessages);
      notes = await this.loadSessionNotesForEstimate(sessionId);
      const planningEstimate = await this.loadSessionPlanningForEstimate(sessionId);
      plans = planningEstimate.plans;
      tasks = planningEstimate.tasks;
      todos = planningEstimate.todos;
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
      this.appendSessionSegments(segments, messages, notes, plans, tasks, todos, sessionSkills);
    }

    const totalChars = segments.reduce((s, x) => s + x.chars, 0);
    const response: ContextEstimateResponse = {
      agentId: agent.id,
      segments,
      totalChars,
      instructionFiles,
      messages,
      notes,
      plans,
      tasks,
      todos,
      sessionSkills,
      tools,
    };
    if (sessionId) response.sessionId = sessionId;
    return response;
  }

  async getContextEstimateForSession(agentId: string, sessionId: string): Promise<unknown> {
    return this.getContextEstimate(agentId, { sessionId });
  }

  async getWorkflowDefinition(workflowId: string): Promise<WorkflowDefinitionApiResponse> {
    const resolver = this.workflowDefinitionResolvers[workflowId];
    if (!resolver) {
      throw new NotFoundError(`Workflow definition '${workflowId}' is not available.`);
    }

    return {
      workflowId,
      format: resolver.format,
      definitionJson: resolver.getJson(),
      definitionYaml: resolver.getYaml(),
    };
  }

  private toToolDefinition(tool: ICommand): LlmToolDefinition {
    const key = ToolIdentity.key(tool.metadata);
    const fromManager = this.toolManager.toSchema(key);
    if (fromManager) return fromManager;
    return {
      name: key,
      description: tool.metadata.description,
      parameters: MetaService.schemaTools.toJsonSchema(tool.metadata.parameters, {
        additionalProperties: true,
      }),
    };
  }

  private buildSystemPromptSegments(
    agent: Awaited<ReturnType<IAgentManager['getAgentAsync']>> & object,
    agentId: string,
    instructionFiles: ContextEstimateInstructionFile[],
    allAgents: Awaited<ReturnType<IAgentManager['getAllAgentsAsync']>>,
    resolvedSkills: Awaited<ReturnType<ISkillManager['resolveSkillsForAgent']>>,
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
    agent: Awaited<ReturnType<IAgentManager['getAgentAsync']>> & object,
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

      const files = await this.agentDocumentStorage.loadAllInstructionFilesAsync();
      return files
        .filter((f: any) => f.instructions?.trim())
        .filter((f: any) => this.isInstructionRelevant(f.applyTo, writePatterns, writtenFiles))
        .map((f: any) => ({
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
      hiddenFromLlm?: boolean;
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
      .filter((m) => !m.archived && m.hiddenFromLlm !== true)
      .map((msg) => {
        const toolCallCount = msg.tool_calls?.length ?? 0;
        const toolMetrics = this.calculateToolMetrics(msg.tool_calls ?? []);
        return {
          role: msg.isHuman ? ('user' as const) : ('assistant' as const),
          preview: msg.content.slice(0, 120),
          chars: msg.content.length,
          toolCallCount,
          toolChars: toolMetrics.llmChars,
          toolRawChars: toolMetrics.rawChars,
          toolSavedChars: toolMetrics.savedChars,
          compactedToolCallCount: toolMetrics.compactedCallCount,
          archived: false,
        };
      });
  }

  private getNoteContentForEstimate(note: { content?: string; compactedContent?: string }): {
    content: string;
    source: 'compacted' | 'content';
  } {
    const compacted = note.compactedContent?.trim();
    if (compacted) {
      return {
        content: compacted,
        source: 'compacted',
      };
    }

    return {
      content: note.content ?? '',
      source: 'content',
    };
  }

  private async loadSessionNotesForEstimate(sessionId: string): Promise<ContextEstimateNote[]> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      return [];
    }

    // Load anchor/active metadata from note_session_shares for this session
    const shares = await this.sessionManager.listNoteSessionSharesAsync(sessionId);
    const activeShareByNoteId = new Map(shares.filter((s) => s.active).map((s) => [s.noteId, s]));

    const allAgents = await this.agentManager.getAllAgentsAsync();

    const noteEntries: Array<{
      note: ContextEstimateNote;
      updatedAt: string;
      anchorMessageId: number | undefined;
    }> = [];

    const seenNoteIds = new Set<string>();

    for (const agent of allAgents) {
      const sessionNotes = await this.sessionManager.listAgentNotes(agent.id);
      for (const note of sessionNotes) {
        if (seenNoteIds.has(note.id)) continue;

        const ownerSessionId = note.sessionId;
        const isOwned = ownerSessionId === sessionId;
        const isShared = (note.sharedSessionIds ?? []).includes(sessionId);
        const hasActiveShare = activeShareByNoteId.has(note.id);

        // A note is visible if it's owned/shared AND not hidden from LLM.
        // For anchored compression/linked notes the active flag governs inclusion.
        const isVisibleToCurrentSession = isOwned || isShared || hasActiveShare;
        if (!isVisibleToCurrentSession || note.hiddenFromLlm === true) {
          continue;
        }

        // If the note has a share row for this session, respect the active flag
        const share = activeShareByNoteId.get(note.id);
        if (share === undefined && !isOwned && !isShared) {
          continue;
        }

        const { content, source } = this.getNoteContentForEstimate(note);
        if (!content) {
          continue;
        }

        seenNoteIds.add(note.id);
        noteEntries.push({
          note: {
            id: note.id,
            title: note.title?.trim() || 'Untitled note',
            sessionId: ownerSessionId,
            preview: content.slice(0, 120),
            chars: content.length,
            source,
          },
          updatedAt: note.updatedAt,
          anchorMessageId: share?.anchorMessageId,
        });
      }
    }

    // Sort: anchored notes by anchorMessageId ASC (null/undefined last), then by updatedAt DESC
    return noteEntries
      .sort((left, right) => {
        const la = left.anchorMessageId;
        const ra = right.anchorMessageId;
        if (la != null && ra != null) return la - ra;
        if (la != null) return -1;
        if (ra != null) return 1;
        const updatedDiff =
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
        if (updatedDiff !== 0) return updatedDiff;
        return left.note.id.localeCompare(right.note.id);
      })
      .map((entry) => entry.note);
  }

  private async loadSessionPlanningForEstimate(sessionId: string): Promise<{
    plans: Array<{ id: string; title: string; chars: number }>;
    tasks: Array<{ id: string; title: string; chars: number; status?: string }>;
    todos: Array<{ id: string; content: string; chars: number; done: boolean }>;
  }> {
    if (!this.planningService) {
      return { plans: [], tasks: [], todos: [] };
    }

    const planningTasks = (await this.planningService.listTasks({ sessionId })) as Array<{
      id: string;
      planId: string;
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      assignedTo?: string;
      sourceActionItem?: string;
    }>;

    const tasks = planningTasks.map((task) => {
      const taskText = [
        task.title ?? 'Untitled task',
        task.description ?? '',
        task.status ? `status:${task.status}` : '',
        task.priority ? `priority:${task.priority}` : '',
        task.assignedTo ? `assignedTo:${task.assignedTo}` : '',
        task.sourceActionItem ? `source:${task.sourceActionItem}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        id: task.id,
        title: task.title?.trim() || 'Untitled task',
        status: task.status,
        chars: taskText.length,
      };
    });

    const todos: Array<{ id: string; content: string; chars: number; done: boolean }> = [];
    for (const task of planningTasks) {
      const taskTodos = (await this.planningService.listTodos(task.id)) as Array<{
        id: string;
        content?: string;
        done?: boolean;
      }>;
      for (const todo of taskTodos) {
        const content = todo.content?.trim() || '(empty todo)';
        const todoText = `${content}\ndone:${todo.done === true ? 'true' : 'false'}`;
        todos.push({
          id: todo.id,
          content,
          done: todo.done === true,
          chars: todoText.length,
        });
      }
    }

    const plans = new Map<string, { id: string; title: string; chars: number }>();
    for (const task of planningTasks) {
      if (!task.planId || plans.has(task.planId)) continue;
      const plan = (await this.planningService.getPlan(task.planId)) as {
        id: string;
        title?: string;
        goal?: string;
        status?: string;
        priority?: string;
      };
      const title = plan.title?.trim() || 'Untitled plan';
      const planText = [
        title,
        plan.goal ?? '',
        plan.status ? `status:${plan.status}` : '',
        plan.priority ? `priority:${plan.priority}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      plans.set(task.planId, {
        id: plan.id,
        title,
        chars: planText.length,
      });
    }

    return {
      plans: Array.from(plans.values()),
      tasks,
      todos,
    };
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

  private calculateToolMetrics(
    toolCalls: Array<{ tool?: string; params?: unknown; result?: unknown; resultLlm?: string }>
  ): {
    llmChars: number;
    rawChars: number;
    savedChars: number;
    compactedCallCount: number;
  } {
    return toolCalls.reduce(
      (acc, tc) => {
        const toolNameChars = tc.tool ? tc.tool.length : 0;
        let paramsChars = 0;
        if (tc.params !== undefined) {
          const serializedParams =
            typeof tc.params === 'string' ? tc.params : JSON.stringify(tc.params);
          paramsChars = serializedParams.length;
        }

        let rawResultChars = 0;
        if (tc.result !== undefined) {
          const serializedRawResult =
            typeof tc.result === 'string' ? tc.result : JSON.stringify(tc.result);
          rawResultChars = serializedRawResult.length;
        }

        let llmResultChars = rawResultChars;
        let compactedCallCount = 0;
        if (tc.resultLlm !== undefined) {
          llmResultChars = tc.resultLlm.length;
          compactedCallCount = 1;
        }

        const rawChars = toolNameChars + paramsChars + rawResultChars;
        const llmChars = toolNameChars + paramsChars + llmResultChars;

        return {
          llmChars: acc.llmChars + llmChars,
          rawChars: acc.rawChars + rawChars,
          savedChars: acc.savedChars + (rawChars - llmChars),
          compactedCallCount: acc.compactedCallCount + compactedCallCount,
        };
      },
      {
        llmChars: 0,
        rawChars: 0,
        savedChars: 0,
        compactedCallCount: 0,
      }
    );
  }

  private sumToolResultChars(
    toolCalls: Array<{ tool?: string; params?: unknown; result?: unknown; resultLlm?: string }>
  ): number {
    return toolCalls.reduce((sum, tc) => {
      const toolNameChars = tc.tool ? tc.tool.length : 0;
      let paramsChars = 0;
      if (tc.params !== undefined) {
        const serializedParams =
          typeof tc.params === 'string' ? tc.params : JSON.stringify(tc.params);
        paramsChars = serializedParams.length;
      }

      const resultContent = tc.resultLlm ?? tc.result;
      let resultChars = 0;
      if (resultContent !== undefined) {
        const serializedResult =
          typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent);
        resultChars = serializedResult.length;
      }

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
        const file = await this.agentDocumentStorage.loadAgentSkillFileAsync(fullPath);
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
    notes: ContextEstimateNote[],
    plans: Array<{ id: string; title: string; chars: number }>,
    tasks: Array<{ id: string; title: string; chars: number; status?: string }>,
    todos: Array<{ id: string; content: string; chars: number; done: boolean }>,
    sessionSkills: ContextEstimateSkill[]
  ): void {
    const activeSkillChars = sessionSkills
      .filter((s) => !s.paused)
      .reduce((sum, s) => sum + s.chars, 0);
    if (activeSkillChars > 0)
      segments.push({ key: 'session_skills', label: 'Session Skills', chars: activeSkillChars });
    const msgTextChars = messages.reduce((sum, m) => sum + m.chars, 0);
    const toolResultChars = messages.reduce((sum, m) => sum + m.toolChars, 0);
    const noteChars = notes.reduce((sum, note) => sum + note.chars, 0);
    const planChars = plans.reduce((sum, plan) => sum + plan.chars, 0);
    const taskChars = tasks.reduce((sum, task) => sum + task.chars, 0);
    const todoChars = todos.reduce((sum, todo) => sum + todo.chars, 0);
    if (msgTextChars > 0)
      segments.push({ key: 'messages', label: 'Chat Messages', chars: msgTextChars });
    if (toolResultChars > 0)
      segments.push({ key: 'tool_results', label: 'Tool Results', chars: toolResultChars });
    if (noteChars > 0) segments.push({ key: 'notes', label: 'Notes', chars: noteChars });
    if (planChars > 0) segments.push({ key: 'plans', label: 'Plans', chars: planChars });
    if (taskChars > 0) segments.push({ key: 'tasks', label: 'Tasks', chars: taskChars });
    if (todoChars > 0) segments.push({ key: 'todos', label: 'Todos', chars: todoChars });
  }
}
