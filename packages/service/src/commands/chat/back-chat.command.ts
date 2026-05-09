import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { NavStackEntry, OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { emitLog } from '../../orchestrator/stream-events.js';
import { write } from './shared-chat-commands.js';

export class BackChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'back';
  readonly description = 'Return to previous agent in handoff chain';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(_args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const navStack: NavStackEntry[] = ctx.navStack ?? [];
    if (navStack.length === 0) {
      write(ctx, 'No previous agent to return to.');
      return;
    }
    const prev = navStack.pop()!;
    const prevAgent = await ctx.agentManager.getAgentAsync(prev.agentId);
    if (!prevAgent) {
      emitLog(ctx.hooks, 'warn', `Previous agent ${prev.agentId} no longer found.`);
      return;
    }
    const prevHistory = await ctx.sessionManager.getSessionMessages(prev.sessionId);
    ctx.agent = prevAgent;
    ctx.sessionId = prev.sessionId;
    ctx.history = prevHistory;
    write(ctx, `\n← Returned to ${prevAgent.name} (${prevAgent.role})\n`);
  }
}
