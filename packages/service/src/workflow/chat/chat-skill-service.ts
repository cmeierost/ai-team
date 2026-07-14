import path from 'node:path';
import type {
  Agent,
  AgentSkillFile,
  ExecutionContext,
  IEmitService,
  ISkillManager,
  ResolvedAgentSkills,
  Skill,
} from '@ai-team/core';

import type { SessionManager } from '../../sessions/session-manager.js';

export interface ChatSkillServiceDependencies {
  skillManager: ISkillManager;
  sessionManager: Pick<SessionManager, 'getSessionSkills' | 'addSessionSkill' | 'appendMessage'>;
  emitService: IEmitService;
  workspaceRoot?: string;
}

export interface ChatSkillResolutionInput {
  userMessage: string;
  ctx: ExecutionContext;
}

export interface ChatSkillResolutionResult {
  skills: Skill[];
  missingSkillNames: string[];
}

export interface IChatSkillService {
  resolveSkillsForTurnAsync(input: ChatSkillResolutionInput): Promise<ChatSkillResolutionResult>;
}

/**
 * Resolves and caches chat skills for the lifetime of a chat session.
 *
 * Cache scope is `sessionId + agentId`, so each session gets isolated resolution state
 * and skills are loaded once per agent per session.
 */
export class ChatSkillService implements IChatSkillService {
  private readonly resolvedSkillsBySessionId = new Map<string, Map<string, ResolvedAgentSkills>>();

  constructor(private readonly deps: ChatSkillServiceDependencies) {}

  async resolveSkillsForTurnAsync(
    input: ChatSkillResolutionInput
  ): Promise<ChatSkillResolutionResult> {
    const { userMessage, ctx } = input;
    const agent = ctx.agent;

    if (!agent || !ctx.sessionId) {
      return {
        skills: [],
        missingSkillNames: [],
      };
    }

    const resolvedSkills = await this.resolveAgentSkillsWithSessionCacheAsync(agent, ctx.sessionId);
    const sessionSkillFiles = await this.resolveTriggeredSessionSkillsAsync({
      agent,
      sessionId: ctx.sessionId,
      userMessage,
    });

    return {
      skills: [...resolvedSkills.skills, ...(sessionSkillFiles as unknown as Skill[])],
      missingSkillNames: resolvedSkills.missingSkillNames,
    };
  }

  private async resolveAgentSkillsWithSessionCacheAsync(
    agent: Agent,
    sessionId: string
  ): Promise<ResolvedAgentSkills> {
    const cacheByAgent = this.getSessionCache(sessionId);
    const cached = cacheByAgent.get(agent.id);
    if (cached) {
      return cached;
    }

    const resolved = await this.deps.skillManager.resolveSkillsForAgent(agent);
    cacheByAgent.set(agent.id, resolved);

    for (const missingSkillName of resolved.missingSkillNames) {
      this.deps.emitService.log('warn', `[skills] Skill not found: ${missingSkillName}`);
    }

    return resolved;
  }

  private getSessionCache(sessionId: string): Map<string, ResolvedAgentSkills> {
    const existing = this.resolvedSkillsBySessionId.get(sessionId);
    if (existing) {
      return existing;
    }

    const created = new Map<string, ResolvedAgentSkills>();
    this.resolvedSkillsBySessionId.set(sessionId, created);
    return created;
  }

  private async resolveTriggeredSessionSkillsAsync(input: {
    agent: Agent;
    sessionId: string;
    userMessage: string;
  }): Promise<AgentSkillFile[]> {
    const allowedSkillIds = (input.agent.skills ?? []).map((skill: { id: string }) => skill.id);
    if (allowedSkillIds.length === 0) {
      return [];
    }

    const existingSessionSkills = await this.deps.sessionManager.getSessionSkills(input.sessionId);
    const loadedRecords = existingSessionSkills.map((record) => ({
      skillPath: record.skillPath,
      paused: record.paused,
    }));

    const { newlyLoaded, activeSkills } = await this.deps.skillManager.resolveSessionSkills(
      allowedSkillIds,
      loadedRecords,
      input.userMessage
    );

    for (const skill of newlyLoaded) {
      const runtimeWorkspaceRoot = this.deps.workspaceRoot;
      const relPath = path
        .relative(runtimeWorkspaceRoot ?? process.cwd(), skill.filePath)
        .replaceAll('\\', '/');
      await this.deps.sessionManager.addSessionSkill(input.sessionId, relPath);
      this.deps.emitService.log('info', `[session-skills] Triggered: ${skill.name}`);
      await this.persistSessionSkillToolCallAsync({
        agentId: input.agent.id,
        sessionId: input.sessionId,
        skillName: skill.name,
        skillPath: relPath,
        triggerMessage: input.userMessage,
      });
    }

    for (const skill of activeSkills) {
      if (!newlyLoaded.includes(skill)) {
        this.deps.emitService.log('info', `[session-skills] Active: ${skill.name}`);
      }
    }

    return activeSkills;
  }

  private async persistSessionSkillToolCallAsync(input: {
    agentId: string;
    sessionId: string;
    skillName: string;
    skillPath: string;
    triggerMessage: string;
  }): Promise<void> {
    const resultText = `Loaded session skill \"${input.skillName}\".`;
    await this.deps.sessionManager.appendMessage(input.sessionId, {
      timestamp: new Date().toISOString(),
      from: input.agentId,
      to: 'human',
      isHuman: false,
      content: '',
      tool_calls: [
        {
          tool: 'skill_load',
          params: {
            skillName: input.skillName,
            skillPath: input.skillPath,
            triggerMessage: input.triggerMessage,
          },
          result: {
            status: 'loaded',
            message: resultText,
            skillName: input.skillName,
            skillPath: input.skillPath,
          },
          resultLlm: resultText,
        },
      ],
    });
  }
}
