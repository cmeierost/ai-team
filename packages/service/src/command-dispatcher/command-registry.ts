import type {
  ICommand,
  ICommandDescriptor,
  ICommandRegistry,
  IServiceContainer,
  CommandAvailability,
  ILlmToolDefinition,
} from '@ai-team/core';
import { ZodSchemaTools } from '../utils/zod-schema.js';

/**
 * Derives the canonical dispatch/registry key for a command.
 * When a group is set, the key is `{group}-{key}` (kebab-case).
 * Without a group, the bare `key` is used.
 */
export function deriveRegistryKey(group: string | undefined, key: string): string {
  return group ? `${group}-${key}` : key;
}

/** Converts `snake_case` or `kebab-case` to `camelCase` for key normalization. */
function snakeToCamel(key: string): string {
  return key.replace(/[-_]([a-z])/g, (_, c: string) => c.toUpperCase());
}

type RegistryEntry = {
  metadata: ICommandDescriptor;
  factory: (resolver: IServiceContainer) => ICommand<unknown, unknown>;
};

/**
 * Concrete implementation of ICommandRegistry.
 *
 * Stores (descriptor, factory) pairs. Commands are never instantiated at
 * registration time — callers supply a resolver when they need an instance
 * via `resolve()`. This enables lazy, scoped construction: each call site
 * decides which DI scope the command should be created in.
 *
 * Surface-agnostic: the registry does not care whether a command is a tool,
 * a slash command, or a CLI command — that is determined solely by the
 * `availableIn` flags on each descriptor.
 */
export class CommandRegistry implements ICommandRegistry {
  private readonly entries = new Map<string, RegistryEntry>();
  /** alias → canonical key */
  private readonly aliases = new Map<string, string>();
  private static readonly schemaTools = new ZodSchemaTools();

  register(
    metadata: ICommandDescriptor,
    factory: (resolver: IServiceContainer) => ICommand<unknown, unknown>
  ): void {
    const registryKey = CommandRegistry.getRegistryKey(metadata);
    const toolAlias = CommandRegistry.getDerivedToolName(metadata);
    const entryAliases = new Set<string>();
    if (toolAlias && toolAlias !== registryKey) {
      entryAliases.add(toolAlias);
    }
    // Register explicit aliases declared in the descriptor.
    for (const alias of metadata.aliases ?? []) {
      if (alias !== registryKey) {
        entryAliases.add(alias);
      }
    }

    if (this.entries.has(registryKey)) {
      throw new Error(`Duplicate command key '${registryKey}' in CommandRegistry.`);
    }

    for (const alias of entryAliases) {
      const existingAliasTarget = this.aliases.get(alias);
      if (existingAliasTarget && existingAliasTarget !== registryKey) {
        throw new Error(
          `Duplicate command alias '${alias}' targets both '${existingAliasTarget}' and '${registryKey}'.`
        );
      }

      if (this.entries.has(alias) && alias !== registryKey) {
        throw new Error(
          `Command alias '${alias}' for '${registryKey}' conflicts with existing command key '${alias}'.`
        );
      }
    }

    this.entries.set(registryKey, { metadata, factory });
    for (const alias of entryAliases) {
      this.aliases.set(alias, registryKey);
    }
  }

  get(key: string): ICommandDescriptor | undefined {
    const canonical = this.aliases.get(key) ?? key;
    const direct = this.entries.get(canonical)?.metadata;
    if (direct) return direct;
    const camel = snakeToCamel(key);
    if (camel !== key) {
      const canonicalCamel = this.aliases.get(camel) ?? camel;
      return this.entries.get(canonicalCamel)?.metadata;
    }
    return undefined;
  }

  getAll(filter?: {
    availableIn?: Partial<CommandAvailability>;
    group?: string;
  }): ICommandDescriptor[] {
    const all = [...this.entries.values()].map((e) => e.metadata);
    if (!filter) return all;

    return all.filter((d) => {
      if (filter.group !== undefined && d.group !== filter.group) return false;
      const av = filter.availableIn;
      if (!av) return true;
      if (av.cli && !d.availableIn.cli) return false;
      if (av.chat && !d.availableIn.chat) return false;
      if (av.cliChat && !d.availableIn.cliChat) return false;
      if (av.tool && !d.availableIn.tool) return false;
      return true;
    });
  }

  resolve(key: string, resolver: IServiceContainer): ICommand<unknown, unknown> | undefined {
    const canonical = this.aliases.get(key) ?? key;
    const direct = this.entries.get(canonical);
    if (direct) return direct.factory(resolver);
    const camel = snakeToCamel(key);
    if (camel !== key) {
      const canonicalCamel = this.aliases.get(camel) ?? camel;
      const entry = this.entries.get(canonicalCamel);
      if (entry) return entry.factory(resolver);
    }
    return undefined;
  }

  toLlmToolDefinitions(): ILlmToolDefinition[] {
    const toolNameOwners = new Map<string, string>();

    return this.getAll({ availableIn: { tool: true } }).map((d) => {
      if (!d.group?.trim()) {
        throw new Error(
          `Tool-exposed command '${d.key}' is missing group. Tool names must derive from group_snake_case.`
        );
      }

      const derivedName = CommandRegistry.deriveLlmToolName(d.group, d.key);
      const existingOwner = toolNameOwners.get(derivedName);
      if (existingOwner && existingOwner !== d.key) {
        throw new Error(
          `Duplicate derived tool name '${derivedName}' from commands '${existingOwner}' and '${d.key}'.`
        );
      }
      toolNameOwners.set(derivedName, d.key);

      const schema = d.parameters
        ? CommandRegistry.schemaTools.toJsonSchema(d.parameters)
        : undefined;

      return {
        name: derivedName,
        description: d.summary ?? d.description,
        parameters: schema,
        group: d.group,
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

  private static getDerivedToolName(d: ICommandDescriptor): string | undefined {
    if (!d.availableIn?.tool) return undefined;
    if (!d.group?.trim()) {
      throw new Error(
        `Tool-exposed command '${d.key}' is missing group. Tool names must derive from group_snake_case.`
      );
    }
    return CommandRegistry.deriveLlmToolName(d.group, d.key);
  }

  private static isToolOnly(d: ICommandDescriptor): boolean {
    const available = d.availableIn ?? {};
    return Boolean(available.tool) && !available.chat && !available.cli && !available.cliChat;
  }

  private static getRegistryKey(d: ICommandDescriptor): string {
    return deriveRegistryKey(d.group, d.key);
  }
}
