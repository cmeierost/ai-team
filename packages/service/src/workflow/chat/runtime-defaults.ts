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
import { isHandoffAutoReactMessage } from './handoff-auto-react.js';

function historyToMessages(history: ChatMessage[]): ILlmChatMessageParam[] {
  return history
    .filter(
      (msg) =>
        !msg.archived &&
        !msg.hiddenFromLlm &&
        !(msg.isHuman && isHandoffAutoReactMessage(msg.content))
    )
    .flatMap<ILlmChatMessageParam>((msg): ILlmChatMessageParam[] => {
      if (msg.handoffType === 'agent-briefing') {
        const fromAgentName = formatAgentName(msg.from);
        const toAgentName = formatAgentName(msg.to ?? msg.targetAgentId ?? 'target-agent');
        return [{
          role: 'user' as const,
          content: [
            `[Internal handoff — ${fromAgentName} → ${toAgentName}]`,
            `The human developer is now your conversational counterpart. Respond to the developer, not ${fromAgentName}.`,
            `A return path to ${fromAgentName} is available through session_return. Call it only after the developer clearly asks to return/report back or confirms this delegated work is finished. Do not return merely because you have produced an answer, and do not use com_handoff to simulate a return.`,
            'Use this colleague briefing as context and continue from it. Do not ask the developer to repeat information already included here.',
            `${fromAgentName} wrote:`,
            msg.content,
          ].join('\n\n'),
        }];
      }

      if (!msg.isHuman && msg.tool_calls?.length) {
        return msg.tool_calls.flatMap<ILlmChatMessageParam>((toolCall, index) => {
          const toolCallId = `persisted-tool-${msg.id ?? msg.timestamp}-${toolCall.id ?? index}`;
          const toolResult =
            toolCall.resultLlm
            ?? (toolCall.result === undefined ? '' : JSON.stringify(toolCall.result));

          return [
            {
              role: 'assistant' as const,
              content: msg.content || null,
              tool_calls: [
                {
                  id: toolCallId,
                  type: 'function' as const,
                  function: {
                    name: toolCall.tool,
                    arguments: JSON.stringify(toolCall.params ?? {}),
                  },
                },
              ],
            },
            {
              role: 'tool' as const,
              tool_call_id: toolCallId,
              content: toolResult,
            },
          ];
        });
      }

      return [{
        role: msg.from === 'human' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }];
    });
}

function formatAgentName(agentId: string): string {
  return agentId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
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
    const workflowPolicy = this.resolveWorkflowToolPolicy(ctx.workflowState);
    const resolved = this.toolManager.getForAgent(ctx.agent!).filter((tool) => {
      const key = ToolIdentity.key(tool.metadata);
      if (key === 'hr_hire') return false;
      if (workflowPolicy && !this.isToolAllowedByWorkflowPolicy(workflowPolicy, tool.metadata)) {
        return false;
      }
      return true;
    });

    // Handoff is a core chat capability, not an agent opt-in. Keep it
    // available even if an adapter's agent-specific catalog omitted the
    // default, while still honoring an explicit workflow allow/deny/remove policy.
    const handoff = this.toolManager.get?.('com_handoff');
    if (
      handoff
      && !resolved.some((tool) => ToolIdentity.key(tool.metadata) === 'com_handoff')
      && (!workflowPolicy || this.isToolAllowedByWorkflowPolicy(workflowPolicy, handoff.metadata))
    ) {
      resolved.push(handoff);
    }

    // A return is meaningful only when the active workflow either defines
    // custom parent restoration or has a completed tool result to return.
    // Keep the tool out of ordinary chats before either condition is true.
    const workflowReturn = this.toolManager.get?.('session_return');
    const hasParentWorkflow =
      (ctx.workflowStack?.length ?? 0) > 0 || (ctx.navStack?.length ?? 0) > 0;
    if (
      ((ctx.workflowReturn?.command && hasParentWorkflow)
        || ctx.workflowLastResult !== undefined)
      && workflowReturn
      && !resolved.some((tool) => ToolIdentity.key(tool.metadata) === 'session_return')
      && (!workflowPolicy
        || this.isToolAllowedByWorkflowPolicy(workflowPolicy, workflowReturn.metadata))
    ) {
      resolved.push(workflowReturn);
    }

    return resolved;
  }

  private resolveWorkflowToolPolicy(workflowState: unknown):
    | {
        allow?: string[];
        deny?: string[];
        remove?: string[];
      }
    | undefined {
    if (!workflowState || typeof workflowState !== 'object' || Array.isArray(workflowState)) {
      return undefined;
    }

    const bag = workflowState as Record<string, unknown>;
    const workflow =
      bag['workflow'] && typeof bag['workflow'] === 'object' && !Array.isArray(bag['workflow'])
        ? (bag['workflow'] as Record<string, unknown>)
        : undefined;

    const policyCandidate =
      bag['workflowToolPolicy'] ??
      bag['toolPolicy'] ??
      workflow?.['workflowToolPolicy'] ??
      workflow?.['toolPolicy'];

    if (
      !policyCandidate ||
      typeof policyCandidate !== 'object' ||
      Array.isArray(policyCandidate)
    ) {
      return undefined;
    }

    const policy = policyCandidate as Record<string, unknown>;
    const toSelectors = (value: unknown): string[] | undefined =>
      Array.isArray(value)
        ? value
            .map((entry) => String(entry ?? '').trim())
            .filter((entry) => entry.length > 0)
        : undefined;

    return {
      allow: toSelectors(policy['allow']),
      deny: toSelectors(policy['deny']),
      remove: toSelectors(policy['remove']),
    };
  }

  private isToolAllowedByWorkflowPolicy(
    policy: { allow?: string[]; deny?: string[]; remove?: string[] },
    meta: ICommand['metadata']
  ): boolean {
    const isExplicitlyAllowed =
      !policy.allow ||
      policy.allow.length === 0 ||
      policy.allow.some((selector) => ToolIdentity.matchesSelector(selector, meta));
    const isDenied = [...(policy.deny ?? []), ...(policy.remove ?? [])].some((selector) =>
      ToolIdentity.matchesSelector(selector, meta)
    );
    return isExplicitlyAllowed && !isDenied;
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

export class HandoffToolResultParser implements ITurnResultParser {
  parse(
    structuredResults: StructuredToolResult[],
    _fullResponse: string,
    persistedContent: string,
    ctx: ExecutionContext
  ): Partial<TurnResult> | null {
    const handoffReq = structuredResults.find(isHandoffRequest);
    if (!handoffReq || !isHandoffRequest(handoffReq)) return null;

    // com_handoff resolves and authorizes this ID before returning its structured result.
    // Do not re-resolve it through the old synchronous AgentManager API: production
    // managers are asynchronous, which used to silently discard otherwise valid handoffs.
    if (handoffReq.targetAgentId === ctx.agent?.id) {
      return { text: persistedContent, done: false };
    }

    return {
      text: persistedContent,
      done: false,
      handedOff: true,
      handoffTargetId: handoffReq.targetAgentId,
      handoffTargetSessionId: handoffReq.targetSessionId,
      handoffNote: handoffReq.briefingNote,
      handoffTargetWorkflowId: handoffReq.targetWorkflowId,
      handoffWorkflowToolPolicy: handoffReq.workflowToolPolicy,
      sourceToolCallId: handoffReq.sourceToolCallId,
      sourceSessionId: handoffReq.sourceSessionId,
    };
  }
}

export function buildDefaultTurnResultParsers(): ITurnResultParser[] {
  return [new HandoffToolResultParser()];
}
