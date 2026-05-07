import type { z } from 'zod';
import type { IServiceContainer } from './runtime-contracts.js';
import type { CommandRuntime, ICommand } from './command-types.js';

/**
 * Slim tool execution context carrying only what file-level tools need.
 * Core extends this with richer Agent data for HR/delegation tools.
 */
export interface ToolContext {
  agentId: string;
  workspaceRoot: string;
  /**
   * DI container resolver. Injected by ToolManager at execute time.
   * Tools should use this to resolve services (e.g. IAgentManager) instead of
   * constructing dependencies directly.
   */
  resolve?: IServiceContainer['resolve'];
  /** Optional path permission checker injected by runtime. */
  pathPermissionChecker?: {
    canReadPath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
    canWritePath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
    canListPath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
    assertCanReadPath(
      workspaceRoot: string,
      contextId: string,
      permissions: unknown,
      filePath: string
    ): void;
    assertCanWritePath(
      workspaceRoot: string,
      contextId: string,
      permissions: unknown,
      filePath: string
    ): void;
  };
  /** Optional user-question bridges provided by the active runtime surface (web/CLI). */
  questionInput?: (request: { message: string }) => Promise<string>;
  questionConfirm?: (request: {
    message: string;
    default?: boolean;
    style?: 'confirm' | 'allow';
  }) => Promise<boolean>;
  questionSelect?: (request: {
    message: string;
    choices: Array<{ name: string; value: string; description?: string; recommended?: boolean }>;
    default?: string;
    allowOther?: boolean;
    otherLabel?: string;
    otherPrompt?: string;
  }) => Promise<string>;
  questionPassword?: (request: { message: string; mask?: string }) => Promise<string>;
  questionChecklist?: (request: {
    message: string;
    choices: Array<{ name: string; value: string; description?: string; recommended?: boolean }>;
    default?: string[];
    minSelections?: number;
    maxSelections?: number;
    allowOther?: boolean;
    otherLabel?: string;
    otherPrompt?: string;
  }) => Promise<string[]>;
  /** LSP code-intelligence provider (injected by ToolManager when available). */
  lsp?: {
    execute(operation: string, params: unknown): Promise<unknown>;
    isAvailable(): boolean;
  };
}

/**
 * Declarative permission descriptor attached to each tool.
 * ToolManager reads this to call ContextManager once in canExecute()
 * rather than having each tool do its own permission check internally.
 */
export type PermissionDescriptor =
  | { type: 'none' }
  | { type: 'file-read'; argsPath: string }
  | { type: 'file-write'; argsPath: string }
  | { type: 'agent-delegation'; argsPath: string }
  | { type: 'manage-agents' };

export type ToolIntentMatcher = (input: string) => boolean;

/**
 * The single tool contract.
 *
 * Tools are commands exposed to the LLM (`availableIn.tool = true`) with
 * optional tool-specific affordances like intent matching. Every tool is an
 * agent-executable tool, so `name` and `parameters` are required here rather
 * than modeled as a second interface layer.
 */
export interface ITool<
  TParams = unknown,
  Ctx extends ToolContext = ToolContext,
  TResult = unknown,
> extends ICommand<TParams, Ctx, TResult> {
  /** Human-readable tool label. `key` remains the canonical identifier. */
  name: string;
  /** Zod schema for the tool's parameters — required for all tools. */
  parameters: z.ZodSchema<TParams>;
  /**
   * Optional pre-LLM intent matcher for text-triggered routing.
   * When absent, the runtime falls back to explicit tool/function calls.
   */
  matchesIntent?: ToolIntentMatcher;
  execute(params: TParams, context: Ctx, runtime: CommandRuntime): Promise<TResult>;
}

/**
 * Backward-compatible name for the runtime's typed tool references.
 */
export type AgentTool<
  Ctx extends ToolContext = ToolContext,
  TParams = unknown,
  TResult = unknown,
> = ITool<TParams, Ctx, TResult>;
