import type { IContainerToken, ILlmToolDefinition } from './runtime-contracts.js';
import type { ICommand, CommandAvailability } from './command-types.js';

// ── ICommandRegistry ──────────────────────────────────────────────────────────

/**
 * Single registry for all commands — tools, slash commands, CLI commands,
 * and workflow triggers.
 *
 * `availableIn` flags on each command determine where it is exposed.
 * The registry itself is surface-agnostic.
 */
export interface ICommandRegistry {
  /**
  * Register a command.
  *
  * Implementations must reject duplicate keys or conflicting aliases
  * (fail-fast) to prevent silent catalog drift and ambiguous command routing.
  * Aliases are registered as transparent aliases to the canonical key.
   */
  register(command: ICommand<unknown, unknown>): void;

  /**
   * Look up a command by its canonical key or any of its registered aliases.
   * Returns undefined if not found.
   */
  get(key: string): ICommand<unknown, unknown> | undefined;

  /**
   * Return all commands matching the optional filter.
   * Multiple `availableIn` flags are combined with AND (all must match).
   */
  getAll(
    filter?: { availableIn?: Partial<CommandAvailability>; group?: string }
  ): Array<ICommand<unknown, unknown>>;

  /**
   * Build LLM tool definitions for all commands where `availableIn.tool = true`.
   * Maps each command's Zod schema to a JSON-schema-compatible parameter descriptor.
   */
  toLlmToolDefinitions(): ILlmToolDefinition[];
}

/**
 * DI token for the singleton ICommandRegistry.
 * Registered by the container bootstrap and used by ToolManager, the
 * ChatOrchestrator, CommandDispatcher, and discovery surfaces.
 */
export const COMMAND_REGISTRY_TOKEN: IContainerToken<ICommandRegistry> = {
  id: 'CommandRegistry',
  toString: () => 'Token(CommandRegistry)',
};
