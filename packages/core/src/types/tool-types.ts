import type { z } from 'zod';

/**
 * Slim tool execution context carrying only what file-level tools need.
 * Core extends this with richer Agent data for HR/delegation tools.
 */
export interface ToolContext {
  agentId: string;
  workspaceRoot: string;
  /** Optional user-question bridges provided by the active runtime surface (web/CLI). */
  questionInput?: (request: { message: string }) => Promise<string>;
  questionConfirm?: (request: { message: string; default?: boolean; style?: 'confirm' | 'allow' }) => Promise<boolean>;
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

/**
 * A tool that an agent can execute.
 *
 * Generic over context so core can pass a richer ToolContext (with full Agent)
 * while fs tools only require the slim base ToolContext.
 */
export interface AgentTool<Ctx extends ToolContext = ToolContext> {
  name: string;
  description: string;
  /** Logical group this tool belongs to (e.g. 'fs', 'search', 'hr', 'com'). */
  group?: string;
  parameters: z.ZodSchema;
  permissionCheck?: PermissionDescriptor;
  examples?: string[];
  tags?: string[];
  /**
   * Optional formatter applied to the raw tool result before it is sent to the LLM.
   * When defined, the LLM receives the formatted value rather than the raw JSON.
   * The raw result is still persisted separately.
   */
  formatForLlm?(result: unknown): unknown;
  execute(params: unknown, context: Ctx): Promise<unknown>;
}
