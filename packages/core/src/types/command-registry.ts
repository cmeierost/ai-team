import {
  Token,
  type IContainerToken,
  type ILlmToolDefinition,
  type IServiceContainer,
} from './runtime-contracts.js';
import type { ICommand, ICommandDescriptor, CommandAvailability } from './command-types.js';

// ── ICommandRegistry ──────────────────────────────────────────────────────────

/**
 * Single registry for all commands — tools, slash commands, CLI commands,
 * and workflow triggers.
 *
 * `availableIn` flags on each descriptor determine where a command is exposed.
 * The registry itself is surface-agnostic.
 *
 * Commands are registered as (metadata, factory) pairs. The factory is never
 * called at registration time — callers supply their own scoped resolver when
 * they need an instance (via `resolve()`).
 */
export interface ICommandRegistry {
  /**
   * Register a command by its descriptor and a factory that creates the
   * instance on demand.
   *
   * Implementations must reject duplicate keys or conflicting aliases
   * (fail-fast) to prevent silent catalog drift and ambiguous command routing.
   * Aliases are registered as transparent aliases to the canonical key.
   *
   * The factory receives whatever resolver the caller passes to `resolve()` —
   * this lets callers choose their own DI scope (root, child, request-scoped).
   */
  register(
    metadata: ICommandDescriptor,
    factory: (resolver: IServiceContainer) => ICommand<unknown, unknown>
  ): void;

  /**
   * Look up a command's descriptor by its canonical key or any registered alias.
   * Returns undefined if not found.
   *
   * Use `resolve()` when you need an executable instance.
   */
  get(key: string): ICommandDescriptor | undefined;

  /**
   * Return descriptors for all commands matching the optional filter.
   * Multiple `availableIn` flags are combined with AND (all must match).
   *
   * Use `resolve()` to turn any descriptor into an executable instance.
   */
  getAll(filter?: {
    availableIn?: Partial<CommandAvailability>;
    group?: string;
  }): ICommandDescriptor[];

  /**
   * Instantiate a command by calling its registered factory with the given
   * resolver. The resolver determines the DI scope for the returned instance.
   *
   * Returns undefined if no command is registered under `key`.
   */
  resolve(key: string, resolver: IServiceContainer): ICommand<unknown, unknown> | undefined;

  /**
   * Build LLM tool definitions for all commands where `availableIn.tool = true`.
   * Maps each command's Zod schema to a JSON-schema-compatible parameter descriptor.
   * Works from stored descriptors — does not instantiate any command.
   */
  toLlmToolDefinitions(): ILlmToolDefinition[];
}

/**
 * DI token for the singleton ICommandRegistry.
 * Registered by the container bootstrap and used by ToolManager, the
 * ChatOrchestrator, CommandDispatcher, and discovery surfaces.
 */
export const COMMAND_REGISTRY_TOKEN: IContainerToken<ICommandRegistry> =
  new Token<ICommandRegistry>('CommandRegistry');
