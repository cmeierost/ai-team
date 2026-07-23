import type { z } from 'zod';
import type { Agent } from './agent-models.js';
import type { ChatMessage } from './communication.js';
import type { PermissionDescriptor } from './tool-types.js';

export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

// ── CommandAvailability ───────────────────────────────────────────────────────

/**
 * Declares where a command is exposed.
 *
 * - `cli`  — available as a CLI subcommand
 * - `chat` — available as a chat slash command (/ prefix)
 * - `cliChat` — available as a chat slash command only in CLI chat sessions
 * - `tool` — exposed to the LLM as a callable tool
 */
export interface CommandAvailability {
  cli?: boolean;
  chat?: boolean;
  cliChat?: boolean;
  /** Exposed to the LLM as a callable tool. */
  tool?: boolean;
}

export type CommandInputMode = 'structured' | 'raw-tail' | 'hybrid';

export interface CommandExample {
  value: string;
  surfaces?: Array<'cli' | 'chat' | 'tool' | 'workflow'>;
  description?: string;
}

export interface CommandHelpMetadata {
  /** Optional longer human-facing description shown in help surfaces. */
  description?: string;
  /** Optional usage hints for users. */
  hints?: string[];
  /** Optional examples shown in help views. */
  examples?: CommandExample[];
}

export interface CommandLlmMetadata {
  /** Compact tool description to reduce prompt/context pollution. */
  description?: string;
  /** Optional short hints for model usage guidance. */
  hints?: string[];
  /** Optional short examples for model usage guidance. */
  examples?: string[];
  /** Parameter keys omitted from LLM tool schema exposure. */
  hiddenParameters?: string[];
}

export interface CommandInputMetadata {
  /** Parsing mode for user-provided arguments. */
  mode?: CommandInputMode;
  /**
   * Structured parameter that receives every remaining positional token.
   * Tokens that look like options (for example `--short`) remain values in
   * this array instead of being interpreted as command-level named options.
   */
  variadicParameter?: string;
  /** Whether this command supports JSON-signature invocation. */
  jsonSignature?: boolean;
  /** Parameters that should be resolved from runtime context when available. */
  contextParameters?: string[];
  /** Parameters that can be overridden via human slash/CLI context override path. */
  contextOverrideAllowlist?: string[];
  /** Parameters that must be present after resolution (params/context/workflow/defaults). */
  requiredAtRuntime?: string[];
}

export interface WorkflowInputBinding {
  /** Source path under workflow last-step result payload. */
  fromLastResult?: string;
  /** Source path under workflow-carried data bag. */
  fromWorkflowData?: string;
}

// ── ExecutionContext ─────────────────────────────────────────────────────────

/**
 * Serializable runtime context passed to every command execution.
 * Contains only plain values — no service instances, no function bridges.
 *
 * Note: `signal` is an ephemeral runtime cancellation channel and is not
 * expected to be serialized/persisted.
 *
 * All services (agentManager, sessionManager, etc.) and callable capabilities
 * (emit, question services) must be injected via constructor.
 */
export interface ExecutionContext {
  /** Invocation surface for the current command execution. */
  invocationSurface?: 'slash' | 'tool' | 'cli' | 'api';
  /** Caller type resolved by runtime policy. */
  callerType?: 'human' | 'agent' | 'system';
  /** Convenience flag for callerType === 'human'. */
  calledByHuman?: boolean;
  /** ID of the agent executing this command, if called by an agent. */
  agentId?: string;

  /** The agent currently handling the user's message. */
  agent?: Agent;
  /** Session identifier when invocation is session-bound. */
  sessionId?: string;
  /** Workflow identifier when invocation is workflow-bound. */
  workflowId?: string;
  workflowInstanceId?: string;
  /** Current workflow step being executed. */
  stepId?: string;
  /** Result payload from the last completed workflow step — used by workflowInputBindings. */
  workflowLastResult?: JsonValue;
  /** Abort signal from the calling surface. */
  signal?: AbortSignal;

  /** Message history for the current agent session. */
  history: ChatMessage[];

  currentFiles?: string[];

  /** Loaded workspace instructions for the active session. */
  instructions?: JsonValue;

  /** Back-navigation stack for agent handoff chains. Mutated by /back. */
  navStack?: SessionNavEntry[];

  /** Back-navigation stack for handoff chains. */
  workflowState?: JsonValue;

  /** Depth counter for handoff subworkflows. Incremented when a handoff tool starts a subworkflow. Used to prevent nested handoffs. */
  subworkflowDepth?: number;
}

type AnyFunction = (...args: never[]) => unknown;
type FunctionPropertyKeys<T> = {
  [K in keyof T]-?: Extract<T[K], AnyFunction> extends never ? never : K;
}[keyof T];
type AssertTrue<T extends true> = T;
type _ExecutionContextMustNotExposeFunctionProperties = AssertTrue<
  FunctionPropertyKeys<ExecutionContext> extends never ? true : false
>;

// ── SessionSnapshot ───────────────────────────────────────────────────────────

/**
 * Mutable session state that persists across command executions within a
 * single chat session. Commands that mutate this (e.g. /chat, /back, /new)
 * should declare it as TContext.
 */

export interface SessionNavEntry {
  agentId: string;
  sessionId: string;
  agentName: string;
}

export type ToolIntentMatcher = (input: string) => boolean;

export type CommandResponseError = {
  code?: string;
  message: string;
  details?: unknown;
};

export type CommandResponse<T = unknown> = {
  status: 'ok' | 'error' | 'cancelled';
  message?: string;
  data?: T;
  error?: CommandResponseError;
};

// ── ICommandDescriptor ────────────────────────────────────────────────────────

/**
 * Complete static metadata for a command or workflow definition.
 *
 * This is the shape carried by every `CommandName.metadata` const and by
 * non-command concepts (e.g. WorkflowDefinition) that participate in
 * registration and discovery surfaces.
 *
 * `key`, `description`, and `availableIn` are required.
 */
export interface ICommandDescriptor<TParams = unknown> {
  /** Canonical dispatch key (e.g. "ask", "files-tree"). */
  readonly key: string;
  /** Optional alternative keys that resolve to this command. */
  readonly aliases?: string[];

  /** Human-readable description. Shown in /help, --help, and discovery surfaces. */
  readonly description: string;

  readonly availableIn: CommandAvailability;

  /**
   * Short one-sentence description for LLM tool discovery.
   * Shown in the LLM system prompt. Falls back to `description` when absent.
   */
  readonly summary?: string;

  /** Optional path segments used as canonical command path across surfaces. */
  readonly path?: string[];

  /**
   * Surface-neutral argument pattern shown in help and error messages.
   * Use only the argument tokens — no surface prefix (no leading `/`, `ait`, or command name).
   * Example: `<url> [json-options]`, `<agent>`, `[n]`.
   * The display prefix (`/group key` or `ait group key`) is added by the adapter.
   */
  readonly usage?: string;

  /** Logical group (e.g. 'fs', 'hr', 'team', 'session'). */
  readonly group?: string;

  /**
   * Zod schema for the command's parameters.
   * Required when availableIn.llm = true — used to generate the LLM tool definition.
   */
  readonly parameters?: z.ZodSchema<TParams>;

  /** Optional unified help metadata used by CLI, slash, and discovery surfaces. */
  readonly help?: CommandHelpMetadata;

  /** Optional compact LLM-facing metadata used for tool definition prompts. */
  readonly llm?: CommandLlmMetadata;

  /** Optional input metadata shared by CLI/slash/workflow adapters. */
  readonly input?: CommandInputMetadata;

  /** Optional workflow bindings for pulling input parameters from workflow state. */
  readonly workflowInputBindings?: Record<string, WorkflowInputBinding>;

  readonly permissionCheck?: PermissionDescriptor;
  readonly examples?: string[];
  readonly tags?: string[];
  /** Optional lexical intent anchors for routing/intent detection. */
  readonly intents?: string[];
  /** Optional lexical intent examples for routing/intent detection. */
  readonly intentExamples?: string[];
}

// ── ICommand ──────────────────────────────────────────────────────────────────

/**
 * The single primitive for every callable capability in the system.
 *
 * `ICommand` is the runtime contract. Static metadata lives on `metadata`
 * (typed as `ICommandDescriptor`) and is separate from execution concerns.
 *
 * `availableIn` flags on `metadata` are the only thing that determines where
 * a command is exposed:
 *   - `availableIn.cli`  → CLI subcommand
 *   - `availableIn.chat` → chat slash command (/ prefix in interactive sessions)
 *   - `availableIn.cliChat` → chat slash command available only in CLI sessions
 *   - `availableIn.tool` → LLM-callable tool (requires `parameters`)
 *
 * Services are injected via constructor. `execute` receives only typed params
 * and the serializable context.
 */
export interface ICommand<TParams = unknown, TResult = unknown> {
  readonly metadata: ICommandDescriptor<TParams>;
  /**
   * Optional pre-LLM intent matcher for text-triggered routing.
   * When absent, the runtime falls back to explicit tool/function calls.
   */
  matchesIntent?: ToolIntentMatcher;
  /**
   * Optional transformer applied to the raw result before it is sent to the LLM.
   * When defined, the LLM receives the formatted value; the raw result is still persisted.
   */
  formatForLlm?(result: TResult): unknown;
  // ── Execution ────────────────────────────────────────────────────────────────
  execute(params: TParams, ctx: ExecutionContext): Promise<CommandResponse<TResult>>;
}
