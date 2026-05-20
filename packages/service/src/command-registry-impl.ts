import type {
  ICommand,
  ICommandRegistry,
  CommandAvailability,
  ILlmToolDefinition,
} from '@ai-team/core';
import { ZodSchemaTools } from './utils/zod-schema.js';

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
  private static readonly schemaTools = new ZodSchemaTools();

  register(command: ICommand<unknown, unknown>): void {
    const registryKey = CommandRegistry.getRegistryKey(command);
    const toolAlias = CommandRegistry.getDerivedToolName(command);
    const aliases = new Set(command.aliases ?? []);
    if (toolAlias && toolAlias !== registryKey) {
      aliases.add(toolAlias);
    }

    if (this.commands.has(registryKey)) {
      throw new Error(`Duplicate command key '${registryKey}' in CommandRegistry.`);
    }

    for (const alias of aliases) {
      const existingAliasTarget = this.aliases.get(alias);
      if (existingAliasTarget && existingAliasTarget !== registryKey) {
        throw new Error(
          `Duplicate command alias '${alias}' targets both '${existingAliasTarget}' and '${registryKey}'.`
        );
      }

      if (this.commands.has(alias) && alias !== registryKey) {
        throw new Error(
          `Command alias '${alias}' for '${registryKey}' conflicts with existing command key '${alias}'.`
        );
      }
    }

    this.commands.set(registryKey, command);
    for (const alias of aliases) {
      this.aliases.set(alias, registryKey);
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
      if (!c.group?.trim()) {
        throw new Error(
          `Tool-exposed command '${c.key}' is missing group. Tool names must derive from group_snake_case.`
        );
      }

      const derivedName = CommandRegistry.deriveLlmToolName(c.group, c.key);
      const existingOwner = toolNameOwners.get(derivedName);
      if (existingOwner && existingOwner !== c.key) {
        throw new Error(
          `Duplicate derived tool name '${derivedName}' from commands '${existingOwner}' and '${c.key}'.`
        );
      }
      toolNameOwners.set(derivedName, c.key);

      const schema = c.parameters
        ? CommandRegistry.schemaTools.toJsonSchema(c.parameters)
        : undefined;

      return {
        name: derivedName,
        description: c.summary ?? c.description,
        parameters: schema,
        group: c.group,
      };
    });
  }

  private static toSnakeCase(value: string): string {
    return value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private static deriveLlmToolName(group: string, key: string): string {
    const normalizedGroup = CommandRegistry.toSnakeCase(group);
    const normalizedKey = CommandRegistry.toSnakeCase(key);

    if (!normalizedGroup || !normalizedKey) {
      throw new Error(
        `Unable to derive tool name from group='${group}' and key='${key}'. Both must normalize to non-empty snake_case.`
      );
    }

    return `${normalizedGroup}_${normalizedKey}`;
  }

  private static getDerivedToolName(command: ICommand<unknown, unknown>): string | undefined {
    if (!command.availableIn?.tool) return undefined;
    if (!command.group?.trim()) {
      throw new Error(
        `Tool-exposed command '${command.key}' is missing group. Tool names must derive from group_snake_case.`
      );
    }
    return CommandRegistry.deriveLlmToolName(command.group, command.key);
  }

  private static isToolOnly(command: ICommand<unknown, unknown>): boolean {
    const available = command.availableIn ?? {};
    return Boolean(available.tool) && !available.chat && !available.cli && !available.cliChat;
  }

  private static getRegistryKey(command: ICommand<unknown, unknown>): string {
    const toolName = CommandRegistry.getDerivedToolName(command);
    if (toolName && CommandRegistry.isToolOnly(command)) {
      return toolName;
    }
    return command.key;
  }
}
