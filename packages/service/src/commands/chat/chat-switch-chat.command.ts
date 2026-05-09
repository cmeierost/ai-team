import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { developerNameToId } from '../../utils/git.js';
import { write } from './shared-chat-commands.js';

export class ChatSwitchChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'chat';
  readonly usage = '/chat <name|role>';
  readonly description = 'Switch to another team member';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const query = args.trim();
    if (!query) {
      write(ctx, 'Usage: /chat <name|role>');
      return;
    }

    const matches = await ctx.agentManager.resolveAgentAsync(query);
    if (matches.length === 0) {
      write(ctx, `No agent found matching: "${query}"`);
      return;
    }

    const target = matches.find((a) => a.id !== ctx.agent.id) ?? matches[0];
    if (target.id === ctx.agent.id) {
      write(ctx, `Already talking to ${ctx.agent.name}.`);
      return;
    }

    const current = await ctx.sessionManager.getSession(ctx.sessionId);
    const devId = (current as any)?.developerId ?? developerNameToId('developer');
    const ts = await ctx.sessionManager.getOrCreateLatestSession(target.id, devId);
    const hist = await ctx.sessionManager.getSessionMessages(ts.id);

    (ctx as any).agent = target;
    (ctx as any).sessionId = ts.id;
    (ctx as any).history = hist;
    write(ctx, `\nSwitched to ${target.name} (${target.role})\n`);
  }
}
