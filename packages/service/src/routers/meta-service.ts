import path from 'node:path';
import type { IContextService } from '@ai-team/api-client';
import { loadAllInstructionFiles, loadAgentSkillFile } from '@ai-team/infrastructure';
import type { AgentManager, SkillManager } from '@ai-team/infrastructure';
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

export interface ContextEstimateResponse {
  agentId: string;
  sessionId?: string;
  segments: ContextEstimateSegment[];
  totalChars: number;
  instructionFiles: ContextEstimateInstructionFile[];
  messages: ContextEstimateMessage[];
  sessionSkills: ContextEstimateSkill[];
}

export class MetaService implements IContextService {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly sessionManager: SessionManager,
    private readonly skillManager: SkillManager
  ) {}

  async getContextEstimate(
    agentId: string,
    query?: { sessionId?: string }
  ): Promise<unknown> {
    const agent = await this.agentManager.getAgentAsync(agentId);
    if (!agent) throw new NotFoundError(`Agent '${agentId}' not found`);

    const workspaceRoot = this.agentManager.workspaceRoot;
    const sessionId = query?.sessionId;

    const [instructionFiles, allAgents, resolvedSkills] = await Promise.all([
      this.loadInstructionFiles(workspaceRoot),
      this.agentManager.getAllAgentsAsync(),
      this.skillManager.resolveSkillsForAgent(agent),
    ]);

    const segments = this.buildSystemPromptSegments(agent, agentId, instructionFiles, allAgents, resolvedSkills);

    let messages: ContextEstimateMessage[] = [];
    let sessionSkills: ContextEstimateSkill[] = [];

    if (sessionId) {
      [messages, sessionSkills] = await Promise.all([
        this.loadSessionMessages(sessionId),
        this.loadSessionSkills(sessionId, workspaceRoot),
      ]);
      this.appendSessionSegments(segments, messages, sessionSkills);
    }

    const totalChars = segments.reduce((s, x) => s + x.chars, 0);
    const response: ContextEstimateResponse = { agentId: agent.id, segments, totalChars, instructionFiles, messages, sessionSkills };
    if (sessionId) response.sessionId = sessionId;
    return response;
  }

  private buildSystemPromptSegments(
    agent: Awaited<ReturnType<AgentManager['getAgentAsync']>> & object,
    agentId: string,
    instructionFiles: ContextEstimateInstructionFile[],
    allAgents: Awaited<ReturnType<AgentManager['getAllAgentsAsync']>>,
    resolvedSkills: Awaited<ReturnType<SkillManager['resolveSkillsForAgent']>>
  ): ContextEstimateSegment[] {
    const identityChars = this.estimateIdentityChars(agent);
    const bioChars = (agent as Record<string, unknown>).markdown
      ? String((agent as Record<string, unknown>).markdown).trim().length
      : 0;
    const skillChars = resolvedSkills.skills.reduce((sum, s) => sum + (s.instructions?.length ?? 0), 0);
    const instructionChars = instructionFiles.reduce((sum, f) => sum + f.chars, 0);
    const teamChars = allAgents
      .filter((a) => a.id !== agentId)
      .map((a) => `- ${a.name} — ${a.role}`)
      .join('\n').length + 20;

    const segments: ContextEstimateSegment[] = [
      { key: 'identity', label: 'Identity & Personality', chars: identityChars },
    ];
    if (bioChars > 0) segments.push({ key: 'bio', label: 'Bio', chars: bioChars });
    if (skillChars > 0) segments.push({ key: 'skills', label: 'Role Skills', chars: skillChars });
    if (instructionChars > 0) segments.push({ key: 'instructions', label: 'Workspace Instructions', chars: instructionChars });
    if (teamChars > 20) segments.push({ key: 'team', label: 'Team Roster', chars: teamChars });
    return segments;
  }

  private estimateIdentityChars(agent: Record<string, unknown>): number {
    const parts = [`You are ${String(agent.name)}, a virtual AI team member.`, `Your role: ${String(agent.role)}`];
    if (agent.reportsTo) parts.push(`You report to ${JSON.stringify(agent.reportsTo)}.`);
    const p = agent.personality as Record<string, unknown> | undefined;
    if (p?.communication_style) parts.push(`Communication style: ${JSON.stringify(p.communication_style)}`);
    if (p?.expertise_level) parts.push(`Expertise level: ${JSON.stringify(p.expertise_level)}`);
    const cliBlock = '## CLI Commands Available To The User\nThe developer can run these in-chat commands: chat, list, hire, history, portfolio, graph, overview, run, help, exit.\nHANDOFF: <name-or-role> | <message>.\nStay in character. Be concise and helpful.';
    return parts.join('\n').length + cliBlock.length;
  }

  private async loadInstructionFiles(workspaceRoot: string): Promise<ContextEstimateInstructionFile[]> {
    try {
      const files = await loadAllInstructionFiles(workspaceRoot);
      return files
        .filter((f) => f.instructions?.trim())
        .map((f) => ({
          path: path.relative(workspaceRoot, f.filePath).replaceAll('\\', '/'),
          label: path.basename(f.filePath),
          chars: f.instructions.length,
        }));
    } catch {
      return [];
    }
  }

  private async loadSessionMessages(sessionId: string): Promise<ContextEstimateMessage[]> {
    const sessionMessages = await this.sessionManager.getSessionMessages(sessionId);
    return sessionMessages
      .filter((m) => !m.archived)
      .map((msg) => {
        const toolCallCount = msg.tool_calls?.length ?? 0;
        const toolChars = this.sumToolResultChars(msg.tool_calls ?? []);
        return {
          role: msg.isHuman ? ('user' as const) : ('assistant' as const),
          preview: msg.content.slice(0, 120),
          chars: msg.content.length + toolChars,
          toolCallCount,
          toolChars,
          archived: false,
        };
      });
  }

  private sumToolResultChars(toolCalls: Array<{ result?: unknown; resultLlm?: unknown }>): number {
    return toolCalls.reduce((sum, tc) => {
      const resultContent = tc.resultLlm ?? tc.result;
      if (resultContent === undefined) return sum;
      const serialized = typeof resultContent === 'string' ? resultContent : JSON.stringify(resultContent);
      return sum + serialized.length;
    }, 0);
  }

  private async loadSessionSkills(sessionId: string, workspaceRoot: string): Promise<ContextEstimateSkill[]> {
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
      results.push({ name: skillName, skillPath: sk.skillPath, chars, paused: sk.paused, isSessionSkill: true });
    }
    return results;
  }

  private appendSessionSegments(
    segments: ContextEstimateSegment[],
    messages: ContextEstimateMessage[],
    sessionSkills: ContextEstimateSkill[]
  ): void {
    const activeSkillChars = sessionSkills.filter((s) => !s.paused).reduce((sum, s) => sum + s.chars, 0);
    if (activeSkillChars > 0) segments.push({ key: 'session_skills', label: 'Session Skills', chars: activeSkillChars });
    const msgChars = messages.reduce((sum, m) => sum + m.chars, 0);
    if (msgChars > 0) segments.push({ key: 'messages', label: 'Session Messages', chars: msgChars });
  }
}

