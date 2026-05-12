import type { ICommand, CommandResponse, ExecutionContext } from '@ai-team/core';

type RegistryEntry = Pick<ICommand, 'usage' | 'description' | 'key' | 'availableIn'>;

export class HelpChatCommand implements ICommand<string, string> {
  readonly key = 'help';
  readonly description = 'Show this help';
  readonly availableIn = { chat: true, tool: true };
  readonly group = 'chat';

  constructor(private readonly getRegistry: () => RegistryEntry[]) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const surface = ctx.invocationSurface;
    const isToolInvocation = surface === 'tool';
    const isCliInvocation = surface === 'cli';
    const entries = this.getRegistry();

    const visibleEntries = isToolInvocation
      ? entries.filter((entry) => entry.availableIn?.tool)
      : entries;

    const lines = [
      isToolInvocation ? '\nAvailable tool-callable commands:\n' : '\nAvailable commands:\n',
    ];

    for (const c of visibleEntries) {
      const cmd = c.usage ?? `/${c.key}`;
      lines.push(`  ${cmd.padEnd(26)} ${c.description}`);
    }

    if (!isToolInvocation) {
      lines.push(`  ${'#<tool> <json>'.padEnd(26)} Run a direct tool call`);
      if (isCliInvocation) {
        lines.push(`  ${'exit'.padEnd(26)} End the session`);
      }
    }

    const text = lines.join('\n');
    return { status: 'ok', message: text, data: text };
  }
}
