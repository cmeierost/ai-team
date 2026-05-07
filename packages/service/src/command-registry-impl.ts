import type {
  ICommand,
  ICommandRegistry,
  CommandAvailability,
  ILlmToolDefinition,
} from '@ai-team/core';

/**
 * Convert a Zod schema to a JSON Schema object for LLM function-calling.
 * Zod v4 has a built-in toJSONSchema() method; falls back to permissive object schema.
 */
function zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && typeof (schema as any).toJSONSchema === 'function') {
    return (schema as any).toJSONSchema() as Record<string, unknown>;
  }
  return { type: 'object', properties: {} };
}

/**
 * Concrete implementation of ICommandRegistry.
 *
 * Holds all registered commands and alias → canonical-key mappings.
 * Surface-agnostic: the registry does not care whether a command is a tool,
 * a slash command, or a CLI command — that is determined solely by
 * the `availableIn` flags on each ICommand.
 */
export class CommandRegistry implements ICommandRegistry {
  private readonly commands = new Map<string, ICommand<unknown, unknown, unknown>>();
  /** alias → canonical key */
  private readonly aliases = new Map<string, string>();

  register(command: ICommand<unknown, unknown, unknown>): void {
    this.commands.set(command.key, command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.key);
      }
    }
  }

  get(key: string): ICommand<unknown, unknown, unknown> | undefined {
    const canonical = this.aliases.get(key) ?? key;
    return this.commands.get(canonical);
  }

  getAll(
    filter?: { availableIn?: Partial<CommandAvailability>; group?: string }
  ): Array<ICommand<unknown, unknown, unknown>> {
    const all = [...this.commands.values()];
    if (!filter) return all;

    return all.filter((c) => {
      if (filter.group !== undefined && c.group !== filter.group) return false;
      const av = filter.availableIn;
      if (!av) return true;
      if (av.cli && !c.availableIn.cli) return false;
      if (av.chat && !c.availableIn.chat) return false;
      if (av.tool && !c.availableIn.tool) return false;
      return true;
    });
  }

  toLlmToolDefinitions(): ILlmToolDefinition[] {
    return this.getAll({ availableIn: { tool: true } }).map((c) => {
      const schema = c.parameters ? zodSchemaToJsonSchema(c.parameters) : undefined;

      return {
        name: c.key,
        description: c.summary ?? c.description,
        parameters: schema,
        group: c.group,
      };
    });
  }
}
