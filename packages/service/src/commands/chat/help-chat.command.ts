import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import type { ChatSlashCommand } from './shared-chat-commands.js';
import { write } from './shared-chat-commands.js';

type RegistryEntry = Pick<ChatSlashCommand, 'usage' | 'description' | 'key' | 'availableIn'>;

export class HelpChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'help';
  readonly description = 'Show this help';
  readonly availableIn = { chat: true, tool: true };
  readonly group = 'chat';

  constructor(private readonly getRegistry: () => RegistryEntry[]) {}

  async execute(
    _args: string,
    ctx: OrchestratorContext,
    runtime: CommandRuntime
  ): Promise<void> {
    const entries = this.getRegistry();
    const isToolInvocation = runtime.invocationSurface === 'tool';

    const visibleEntries = isToolInvocation
      ? entries.filter((entry) => entry.availableIn?.tool)
      : entries;

    const lines = [
      isToolInvocation
        ? '\nAvailable tool-callable commands:\n'
        : '\nAvailable commands:\n',
    ];

    for (const c of visibleEntries) {
      lines.push(`  ${(c.usage ?? `/${c.key}`).padEnd(26)} ${c.description}`);
    }

    if (!isToolInvocation) {
      lines.push(`  ${'#<tool> <json>'.padEnd(26)} Run a direct tool call`);
      lines.push(`  ${'exit'.padEnd(26)} End the session`);
    }

    write(ctx, lines.join('\n'));
  }
}
