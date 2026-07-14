import type {
  ICommand,
  CommandResponse,
  ChatSession,
  ExecutionContext,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SessionManager } from '../../sessions/session-manager.js';

function buildGraphLines(chain: ChatSession[], currentSessionId: string): string[] {
  const childrenOf = new Map<string, ChatSession[]>();
  for (const s of chain) {
    if (s.previousSessionId) {
      const kids = childrenOf.get(s.previousSessionId) ?? [];
      kids.push(s);
      childrenOf.set(s.previousSessionId, kids);
    }
  }

  const lines: string[] = [];
  const visit = (s: ChatSession, indent: number): void => {
    const prefix = '  '.repeat(indent);
    const marker = s.id === currentSessionId ? ' ← current' : '';
    const agentLabel = (s.agentIds?.length ? s.agentIds : [s.agentId]).filter(Boolean).join(', ');
    const msgCount = s.messageCount ?? '?';
    const lastActivity = s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleString() : '?';
    lines.push(
      `${prefix}${s.id.slice(0, 8)}…  agent: ${agentLabel}  msgs: ${msgCount}  last: ${lastActivity}${marker}`
    );
    for (const child of childrenOf.get(s.id) ?? []) {
      visit(child, indent + 1);
    }
  };

  for (const root of chain.filter((s) => !s.previousSessionId)) {
    visit(root, 0);
  }
  return lines;
}
export const SessionGraphChatCommandMetadata = {
  key: 'graph',
  usage: '/session graph',
  description: 'Show the handoff graph for the current session chain',
  availableIn: { chat: true, tool: false },
  group: 'session',
} satisfies ICommandDescriptor;

export class SessionGraphChatCommand implements ICommand<string, string> {
  readonly metadata = SessionGraphChatCommandMetadata;

  constructor(private readonly sessionManager: Pick<SessionManager, 'getSessionChain'>) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    let chain: ChatSession[];
    try {
      chain = await this.sessionManager.getSessionChain(ctx.sessionId!!);
    } catch {
      return { status: 'error', message: 'Failed to load session chain.' };
    }

    if (chain.length === 0) {
      return { status: 'ok', message: 'No session chain found.' };
    }

    const lines = [
      '\n─── Session handoff graph ──────────────────────────────────',
      ...buildGraphLines(chain, ctx.sessionId!!),
      '──────────────────────────────────────────────────────────\n',
    ];

    const output = lines.join('\n');
    return { status: 'ok', message: output, data: output };
  }
}
