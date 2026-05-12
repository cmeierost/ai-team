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
  private readonly commands = new Map<string, ICommand<unknown, unknown>>();
  /** alias → canonical key */
  private readonly aliases = new Map<string, string>();

  register(command: ICommand<unknown, unknown>): void {
    if (this.commands.has(command.key)) {
      throw new Error(`Duplicate command key '${command.key}' in CommandRegistry.`);
    }

    if (command.aliases) {
      for (const alias of command.aliases) {
        const existingAliasTarget = this.aliases.get(alias);
        if (existingAliasTarget && existingAliasTarget !== command.key) {
          throw new Error(
            `Duplicate command alias '${alias}' targets both '${existingAliasTarget}' and '${command.key}'.`
          );
        }

        if (this.commands.has(alias) && alias !== command.key) {
          throw new Error(
            `Command alias '${alias}' for '${command.key}' conflicts with existing command key '${alias}'.`
          );
        }
      }
    }

    this.commands.set(command.key, command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.key);
      }
    }
  }

  get(key: string): ICommand<unknown, unknown> | undefined {
    const canonical = this.aliases.get(key) ?? key;
    return this.commands.get(canonical);
  }

  getAll(filter?: {
    availableIn?: Partial<CommandAvailability>;
    group?: string;
  }): Array<ICommand<unknown, unknown>> {
    const all = [...this.commands.values()];
    if (!filter) return all;

    return all.filter((c) => {
      if (filter.group !== undefined && c.group !== filter.group) return false;
      const av = filter.availableIn;
      if (!av) return true;
      if (av.cli && !c.availableIn.cli) return false;
      if (av.chat && !c.availableIn.chat) return false;
      if (av.cliChat && !c.availableIn.cliChat) return false;
      if (av.tool && !c.availableIn.tool) return false;
      return true;
    });
  }

  toLlmToolDefinitions(): ILlmToolDefinition[] {
    const toolNameOwners = new Map<string, string>();

    return this.getAll({ availableIn: { tool: true } }).map((c) => {
      if (!c.group || !c.group.trim()) {
        throw new Error(
          `Tool-exposed command '${c.key}' is missing group. Tool names must derive from group_snake_case.`
        );
      }

      const derivedName = deriveLlmToolName(c.group, c.key);
      const existingOwner = toolNameOwners.get(derivedName);
      if (existingOwner && existingOwner !== c.key) {
        throw new Error(
          `Duplicate derived tool name '${derivedName}' from commands '${existingOwner}' and '${c.key}'.`
        );
      }
      toolNameOwners.set(derivedName, c.key);

      const schema = c.parameters ? zodSchemaToJsonSchema(c.parameters) : undefined;

      return {
        name: derivedName,
        description: c.summary ?? c.description,
        parameters: schema,
        group: c.group,
      };
    });
  }
}

function toSnakeCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function deriveLlmToolName(group: string, key: string): string {
  const normalizedGroup = toSnakeCase(group);
  const normalizedKey = toSnakeCase(key);

  if (!normalizedGroup || !normalizedKey) {
    throw new Error(
      `Unable to derive tool name from group='${group}' and key='${key}'. Both must normalize to non-empty snake_case.`
    );
  }

  return `${normalizedGroup}_${normalizedKey}`;
}
