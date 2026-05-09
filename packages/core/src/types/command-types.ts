import type { z } from 'zod';
import type { IContainerToken } from './runtime-contracts.js';
import type { Agent } from './agent-models.js';
import type { ChatMessage } from './communication.js';
import type { PermissionDescriptor } from './tool-types.js';

// ── CommandAvailability ───────────────────────────────────────────────────────

/**
 * Declares where a command is exposed.
 *
 * - `cli`  — available as a CLI subcommand
 * - `chat` — available as a chat slash command (/ prefix)
 * - `tool` — exposed to the LLM as a callable tool
 */
export interface CommandAvailability {
  cli?: boolean;
  chat?: boolean;
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

// ── CommandRuntime ────────────────────────────────────────────────────────────

/**
 * Stateless runtime dependencies injected by the dispatcher for the duration
 * of a single command execution. Does NOT carry mutable session state.
 *
 * Question-bridge types are intentionally inlined (no api-contracts import)
 * to keep core self-contained.
 * 
 * Note: Commands should receive their dependencies via DI (constructor injection).
 * The `resolve` field is NOT available — all services must be DI-injected.
 */
export interface CommandRuntime {
  /** Invocation surface for the current command execution. */
  invocationSurface?: 'slash' | 'tool' | 'cli' | 'api';
  /** Caller type resolved by runtime policy. */
  callerType?: 'human' | 'agent' | 'system';
  /** Convenience flag for callerType === 'human'. */
  calledByHuman?: boolean;
  /** Absolute workspace root path. */
  workspaceRoot: string;
  /** ID of the agent executing this command, if called by an agent. */
  agentId?: string;
  /** Session identifier when invocation is session-bound. */
  sessionId?: string;
  /** Workflow identifier when invocation is workflow-bound. */
  workflowId?: string;
  /** Last workflow step result for workflow-bound parameter binding. */
  workflowLastResult?: unknown;
  /** Workflow-carried data payload for workflow-bound parameter binding. */
  workflowData?: Record<string, unknown>;
  /** Abort signal from the calling surface. */
  signal?: AbortSignal;
  /** Emit a runtime stream event (typed as unknown to keep core free of api-contracts). */
  emit?: (event: unknown) => void;

  // ── Question bridges ────────────────────────────────────────────────────────
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

  // ── Workflow hooks (inlined to keep core free of api-contracts) ─────────────
  /** Pre-populated workflow answers for replay/resume scenarios. */
  workflowState?: {
    workflowId: string;
    continuationToken?: string;
    answers: Record<string, string | boolean | number | string[] | Record<string, string>>;
  };
  /** Called for each workflow step frame to support multi-step workflow UI. */
  onWorkflowFrame?: (frame: {
    workflowId: string;
    stepId: string;
    continuationToken?: string;
    /** Typed as unknown to avoid importing api-contracts into core. */
    question?: unknown;
    completed?: boolean;
    result?: unknown;
    error?: string;
  }) => void;
}

// ── SessionSnapshot ───────────────────────────────────────────────────────────

/**
 * Mutable session state that persists across command executions within a
 * single chat session. Commands that mutate this (e.g. /chat, /back, /new)
 * should declare it as TContext.
 */
export interface SessionSnapshot {
  /** The agent currently handling the user's message. */
  agent: Agent;
  /** Active session ID. */
  sessionId: string;
  /** Message history for the current agent session. */
  history: ChatMessage[];
  /** Back-navigation stack for handoff chains. */
  navStack?: SessionNavEntry[];
}

export interface SessionNavEntry {
  agentId: string;
  sessionId: string;
  agentName: string;
}

/**
 * DI token for the mutable per-session snapshot.
 * The orchestrator registers this into a scoped child container at session start.
 * Slash commands and workflows that need session state resolve this token.
 */
export const SESSION_CONTEXT_TOKEN: IContainerToken<SessionSnapshot> = {
  id: 'SessionSnapshot',
  toString: () => 'Token(SessionSnapshot)',
};

// ── ICommand ──────────────────────────────────────────────────────────────────

/**
 * The single primitive for every callable capability in the system.
 *
 * `availableIn` flags are the only thing that determines where it is exposed:
 *   - `availableIn.cli`  → CLI subcommand
 *   - `availableIn.chat` → chat slash command (/ prefix in interactive sessions)
 *   - `availableIn.llm`  → LLM-callable tool (requires `parameters`)
 *
 * Generics:
 *   - TParams  — typed input arguments (unknown by default)
 *   - TContext — mutable state that persists beyond this call (void = none)
 *   - TResult  — return type (must always be specified explicitly)
 *
 * When TContext is void, pass `undefined` as the context argument.
 */
export interface ICommand<TParams = unknown, TContext = void, TResult = unknown> {
  // ── Metadata ────────────────────────────────────────────────────────────────
  readonly key: string;
  readonly aliases?: string[];

  /** Human-readable description. Shown in /help, --help, and discovery surfaces. */
  readonly description: string;

  /**
   * CLI routing info. Required when availableIn.cli = true.
   * `command` is the Commander word (e.g. 'can'); `parentKey` places it under a sub-group (e.g. 'access').
   */
  readonly cli?: { command: string; parentKey?: string };

  /**
   * Short one-sentence description for LLM tool discovery.
   * Shown in the LLM system prompt. Falls back to `description` when absent.
   */
  readonly summary?: string;

  /** Optional path segments used as canonical command path across surfaces. */
  readonly path?: string[];

  readonly usage?: string;
  readonly availableIn: CommandAvailability;

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

  /**
   * Optional transformer applied to the raw result before it is sent to the LLM.
   * When defined, the LLM receives the formatted value; the raw result is still persisted.
   */
  formatForLlm?(result: TResult): unknown;

  // ── Execution ────────────────────────────────────────────────────────────────
  execute(args: TParams, context: TContext, runtime: CommandRuntime): Promise<TResult>;
}
