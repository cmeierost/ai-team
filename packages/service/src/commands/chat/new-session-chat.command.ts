import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { emitLog } from '../../orchestrator/stream-events.js';
import { developerNameToId } from '../../utils/git.js';
import { write } from './shared-chat-commands.js';

export class NewSessionChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'new';
  readonly description = 'Start a new session with the current agent';
  readonly availableIn = { chat: true, tool: false };

  async execute(_args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const developerId = developerNameToId('developer');
    const fresh = await ctx.sessionManager.createSession(ctx.agent.id, developerId);
    (ctx as any).sessionId = fresh.id;
    (ctx as any).history = [];
    write(ctx, `New session started: ${fresh.id}`);
    emitLog(ctx.hooks, 'info', `[session_switched] ${fresh.id}`);
    ctx.hooks?.emit?.({ kind: 'session_switched', sessionId: fresh.id });
  }
}
