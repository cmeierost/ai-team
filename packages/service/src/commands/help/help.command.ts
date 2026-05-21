import type {
  ICommand,
  CommandResponse,
  ExecutionContext,
  ICommandDescriptor,
} from '@ai-team/core';

type RegistryEntry = Pick<
  ICommandDescriptor,
  'usage' | 'description' | 'key' | 'availableIn' | 'path'
>;
export const HelpChatCommandMetadata = {
  key: 'help',
  description: 'Show this help',
  availableIn: { chat: true, tool: true },
  group: 'chat',
} satisfies ICommandDescriptor;

export class HelpChatCommand implements ICommand<string, string> {
  readonly metadata = HelpChatCommandMetadata;

  constructor(private readonly getRegistry: () => RegistryEntry[]) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const surface = ctx.invocationSurface;
    const isToolInvocation = surface === 'tool';
    const isCliInvocation = surface === 'cli';
    const entries = this.getRegistry();

    const visibleEntries = isToolInvocation
      ? entries.filter((entry) => entry.availableIn?.tool)
      : entries;

    const staticEntries = visibleEntries.filter((entry) => entry.path?.[0] !== 'dynamic');
    const dynamicEntries = visibleEntries.filter((entry) => entry.path?.[0] === 'dynamic');

    const lines: string[] = [];
    const appendSection = (title: string, entries: RegistryEntry[]) => {
      if (entries.length === 0) return;
      lines.push(`\n${title}\n`);
      for (const c of entries) {
        const invocation = `/${c.key}`;
        const usageHint = c.usage && c.usage !== c.key ? ` (${c.usage})` : '';
        lines.push(`  ${invocation.padEnd(26)} ${c.description}${usageHint}`);
      }
    };

    if (isToolInvocation) {
      appendSection('Available tool-callable commands:', staticEntries);
      appendSection('Available dynamic commands:', dynamicEntries);
    } else {
      appendSection('Available commands:', staticEntries);
      appendSection('Available dynamic commands:', dynamicEntries);
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
