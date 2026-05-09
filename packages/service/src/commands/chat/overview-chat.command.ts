import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class OverviewChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'overview';
  readonly description = 'Workspace file overview → shared with agent';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(_args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const { getWorkspaceOverview } = await import('../../utils/workspace.js');
    const overview = await getWorkspaceOverview(ctx.workspaceRoot);
    write(ctx, '\n── Workspace Overview ──────────────────────────────────────\n');
    write(ctx, overview);
    const sysMsg = {
      timestamp: new Date().toISOString(),
      from: 'system' as const,
      content: `Tool Output (overview):\n${overview.slice(0, 4_000)}`,
    };
    await ctx.sessionManager.appendMessage(ctx.sessionId, sysMsg);
    ctx.history.push(sysMsg);
    write(ctx, `\n(Overview shared with ${ctx.agent.name}.)\n`);
  }
}
