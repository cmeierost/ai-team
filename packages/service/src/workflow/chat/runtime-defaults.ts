import { promises as fs } from 'fs';
import path from 'path';
import {
  ContextLevel,
  ExecutionContext,
  isHandoffRequest,
  type Agent,
  type ChatMessage,
  type ICommand,
  type IAgentManager,
  type IEmitService,
  type ILlmChatMessageParam,
  type ILlmService,
  type StructuredToolResult,
  IToolManager,
} from '@ai-team/core';
import type {
  IContextBuilder,
  IContextEnricher,
  ILlmSelector,
  IOutputHandler,
  ITurnResultParser,
  IToolResolver,
  TurnResult,
} from '../runtime/pipeline.js';
import { ToolIdentity } from '../../tooling/manager/tool-manager.js';

function historyToMessages(history: ChatMessage[]): ILlmChatMessageParam[] {
  return history
    .filter((msg) => !msg.archived && !msg.hiddenFromLlm)
    .map((msg) => ({
      role: msg.from === 'human' ? ('user' as const) : ('assistant' as const),
      content: msg.content,
    }));
}

export class DefaultContextBuilder implements IContextBuilder {
  async build(history: ChatMessage[], _ctx: ExecutionContext): Promise<ILlmChatMessageParam[]> {
    return historyToMessages(history);
  }
}

const ARCHITECT_ROLES = ['architect', 'tech-lead', 'engineering-manager', 'cto', 'vp-engineering'];

export class WorkspaceOverviewEnricher implements IContextEnricher {
  readonly name = 'workspace-overview';

  constructor(private readonly workspaceRoot: string) {}

  async enrich(ctx: ExecutionContext): Promise<string | null> {
    const role = ctx.agent!.role.toLowerCase();
    const isHighContextAgent =
      ARCHITECT_ROLES.some((r) => role.includes(r)) ||
      ctx.agent!.contextLevel === ContextLevel.ORGANIZATION ||
      ctx.agent!.contextLevel === ContextLevel.REPOSITORY;

    if (!isHighContextAgent) return null;
    try {
      const tree = await buildDirectoryTree(this.workspaceRoot, 3);
      return `## Current workspace structure\n\`\`\`\n${tree}\n\`\`\``;
    } catch {
      return null;
    }
  }
}

const HR_ROLES = ['hr', 'people-ops', 'recruiter', 'team-lead', 'manager', 'director'];

export class TeamRosterEnricher implements IContextEnricher {
  readonly name = 'team-roster';

  constructor(private readonly agentManager: IAgentManager) {}

  async enrich(ctx: ExecutionContext): Promise<string | null> {
    const role = ctx.agent!.role.toLowerCase();
    const isHrRole = HR_ROLES.some((r) => role.includes(r));

    if (!isHrRole) return null;

    const agents = (await this.agentManager.getAllAgentsAsync()).filter(
      (a: Agent) => a.id !== ctx.agent!.id
    );
    if (agents.length === 0) return null;

    const lines = agents.map(
      (a: Agent) => `- **${a.name}** (${a.role}) [${a.id}]${a.status ? ` — ${a.status}` : ''}`
    );
    return `## Current team roster\n${lines.join('\n')}`;
  }
}

async function buildDirectoryTree(dir: string, maxDepth: number, depth = 0): Promise<string> {
  if (depth >= maxDepth) return '';

  const IGNORE = new Set([
    '.git',
    'node_modules',
    '.ai-team',
    'dist',
    '.next',
    'coverage',
    '.turbo',
  ]);
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  let entries: { name: string; isDir: boolean }[] = [];
  try {
    const raw = await fs.readdir(dir, { withFileTypes: true });
    entries = raw
      .filter((e) => !IGNORE.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return '';
  }

  for (const entry of entries.slice(0, 25)) {
    if (entry.isDir) {
      lines.push(`${indent}${entry.name}/`);
      const subtree = await buildDirectoryTree(path.join(dir, entry.name), maxDepth, depth + 1);
      if (subtree) lines.push(subtree);
    } else {
      lines.push(`${indent}${entry.name}`);
    }
  }

  if (entries.length > 25) lines.push(`${indent}… (${entries.length - 25} more)`);
  return lines.join('\n');
}

export class DefaultToolResolver implements IToolResolver {
  constructor(private readonly toolManager: IToolManager) {}

  async resolve(ctx: ExecutionContext): Promise<ICommand[]> {
    return this.toolManager.getForAgent(ctx.agent!).filter((tool) => {
      const key = ToolIdentity.key(tool.metadata);
      if (key === 'hr_hire') return false;
      // Prevent nested handoffs: disable com_handoff inside a handoff subworkflow.
      if (key === 'com_handoff' && (ctx.subworkflowDepth ?? 0) > 0) return false;
      return true;
    });
  }
}

export class DefaultLlmSelector implements ILlmSelector {
  constructor(private readonly llmService: ILlmService) {}

  async select(ctx: ExecutionContext): Promise<void> {
    await (
      this.llmService as unknown as { initializeForChat?: (agent: unknown) => Promise<void> }
    ).initializeForChat?.(ctx.agent);
  }
}

export class DefaultOutputHandler implements IOutputHandler {
  constructor(private readonly emitService: IEmitService) {}

  async handle(result: TurnResult, _ctx: ExecutionContext): Promise<void> {
    if (!result.handedOff) {
      this.emitService.emit({ kind: 'status', phase: 'complete' });
    }
  }
}

function resolveAgentManagerFromContext(agentManager: IAgentManager): IAgentManager | undefined {
  return agentManager;
}

function resolveNonSelfAgent(
  targetId: string,
  ctx: ExecutionContext,
  agentManager: IAgentManager
): Agent | undefined {
  const getAgent = (agentManager as { getAgent?: (query: string) => Agent | undefined }).getAgent;
  const resolveAgent = (agentManager as { resolveAgent?: (query: string) => Agent[] }).resolveAgent;

  const exact = typeof getAgent === 'function' ? getAgent.call(agentManager, targetId) : undefined;

  if (exact && exact.id !== ctx.agent!.id) return exact;

  return typeof resolveAgent === 'function'
    ? resolveAgent.call(agentManager, targetId).find((a) => a.id !== ctx.agent!.id)
    : undefined;
}

export class HandoffToolResultParser implements ITurnResultParser {
  constructor(private readonly agentManager: IAgentManager) {}

  parse(
    structuredResults: StructuredToolResult[],
    _fullResponse: string,
    persistedContent: string,
    ctx: ExecutionContext
  ): Partial<TurnResult> | null {
    const handoffReq = structuredResults.find(isHandoffRequest);
    if (!handoffReq || !isHandoffRequest(handoffReq)) return null;

    const manager = resolveAgentManagerFromContext(this.agentManager);
    if (!manager) return null;

    const target = resolveNonSelfAgent(handoffReq.targetAgentId, ctx, manager);

    if (!target) {
      return { text: persistedContent, done: false };
    }

    return {
      text: persistedContent,
      done: false,
      handedOff: true,
      handoffTargetId: target.id,
      handoffTargetSessionId: handoffReq.targetSessionId,
      handoffNote: handoffReq.briefingNote,
    };
  }
}

export function buildDefaultTurnResultParsers(agentManager: IAgentManager): ITurnResultParser[] {
  return [new HandoffToolResultParser(agentManager)];
}
