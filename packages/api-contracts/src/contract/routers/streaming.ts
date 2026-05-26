import { CommandResponse } from '../shared-types.js';
import type { ExecutionContext } from '@ai-team/core';
import { ContextLevel, RoleType } from './agents';
import { LlmProfile } from './config';

export type RuntimeStreamEvent =
  | {
      kind: 'status';
      phase?: string;
      message?: string;
    }
  | {
      kind: 'agent_info';
      agentId?: string;
      agentName: string;
      agentRole?: string;
      developerName?: string;
      message?: string;
    }
  | {
      kind: 'progress';
      phase?: string;
      percent?: number;
      message?: string;
    }
  | {
      kind: 'log';
      level?: 'info' | 'warn' | 'error' | 'debug';
      message?: string;
    }
  | {
      kind: 'token';
      text?: string;
    }
  | {
      kind: 'tool';
      toolName?: string;
      toolPhase?: 'request' | 'start' | 'result' | 'error' | 'denied';
      /** Monotonic sequence assigned by server stream emission for deterministic ordering. */
      toolEventSeq?: number;
      message?: string;
      toolDenial?: ToolDenialEvent;
      toolResult?: ToolRuntimePayloadEvent;
    }
  | {
      kind: 'question';
      message?: string;
      questionType?: 'confirm' | 'input' | 'select' | 'password' | 'checklist';
      choices?: QuestionSelectChoice[];
      default?: string | boolean | string[];
      recommended?: string[];
      minSelections?: number;
      maxSelections?: number;
      allowOther?: boolean;
      otherLabel?: string;
      otherPrompt?: string;
    }
  | {
      kind: 'code_edit_proposal';
      message?: string;
      proposalId?: string;
      agentName?: string;
      description?: string;
      filesChanged?: number;
      additions?: number;
      deletions?: number;
      warnings?: string[];
      /** Full file changes — present when kind === 'code_edit_proposal' */
      files?: Array<{
        filePath: string;
        oldContent: string;
        newContent: string;
        additions?: number;
        deletions?: number;
      }>;
    }
  | {
      kind: 'handoff';
      message?: string;
      fromAgentId?: string;
      fromAgentName?: string;
      fromAgentRole?: string;
      fromSessionId?: string;
      toAgentId?: string;
      toAgentName?: string;
      toAgentRole?: string;
      toSessionId?: string;
      handoffNote?: string;
      /** LLM-generated briefing written in the FROM agent's voice */
      briefingContent?: string;
    }
  | {
      kind: 'avatar-preview';
      agentId: string;
      agentName: string;
      previewPath: string;
      /** Base64-encoded image data for web clients that cannot access the file system */
      imageBase64?: string;
    }
  | {
      /** Emitted when a slash command switches the active session (e.g. /new). */
      kind: 'session_switched';
      sessionId: string;
    }
  | {
      /** Emitted when the session title is automatically generated. */
      kind: 'session_title_updated';
      sessionId: string;
      title: string;
    };

export interface AvatarOptions {
  agentQuery: string;
}

// ── Files command response types ─────────────────────────────────────────────

export interface FileTreeNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  size?: number;
  modified?: string;
}

export interface FilesTreeResponse {
  workspaceRoot: string;
  tree?: FileTreeNode;
  /** Agent-scoped annotated file list (present when agent is specified) */
  agent?: { id: string; name: string; role: string };
  annotatedFiles?: Array<{ path: string; readable: boolean; writable: boolean }>;
  writeableFiles?: string[];
  readPatterns?: string[];
  writePatterns?: string[];
  maxDepth: number;
  includeHidden: boolean;
  ignoreGitignore: boolean;
}

export interface FilesPatternsResponse {
  global: { read: string[]; write: string[] };
  agent?: { id: string; name: string; role: string };
  agentPatterns?: { read: string[]; write: string[] };
}

// ── Utility command response types ───────────────────────────────────────────

export interface SystemInfoResponse {
  workspace: string;
  branch: string | null;
  package: { name: string | null; version: string | null; description: string | null } | null;
}

export interface DbStatusResponse {
  schemaVersion: number;
  totalSessions: number;
  totalMessages: number;
  storageSizeBytes?: number;
  dbPath: string;
}

export interface DbMigrateResponse {
  applied: number;
  schemaVersion: number;
}

export interface CodeEditProposalSummary {
  id: string;
  description: string;
  agentName: string;
  status: string;
  timestamp: string;
  filesChanged: number;
  additions: number;
  deletions: number;
  files: string[];
}

export interface CodeEditListResponse {
  proposals: CodeEditProposalSummary[];
  stats: {
    total: number;
    pending: number;
    approved: number;
    applied: number;
    rejected: number;
    failed: number;
  };
}

export interface CreateSkillSetupInput {
  kind: 'skill';
  name: string;
  type: RoleType;
  description: string;
  contextLevel: ContextLevel;
  instructions: string;
  llm?: LlmProfile;
}

export type CreateSetupInput = CreateAgentSetupInput | CreateSkillSetupInput;

export interface CreateOptions {
  name?: string;
  role?: string;
  interactive?: boolean;
  setup?: CreateSetupInput;
}

export interface ChatOptions {
  message?: string;
  context?: string[];
  oneShot?: boolean;

  // Session management
  sessionId?: string; // Resume this specific session
  createNewSession?: boolean; // Force create new session instead of resuming latest
  addAgentToSession?: string; // Add another agent to this session (multi-agent mode)

  /**
   * Introduction text already displayed by the client (e.g. web UI). When provided on an empty-history
   * session, the introduction is persisted (with importance: 'low') immediately before the first user
   * message, without triggering a second LLM call. Mutually exclusive with the CLI introduction flow.
   */
  pendingIntroduction?: string;

  /**
   * Workflow mode: keeps normal chat runtime/orchestrator, but allows tailored onboarding prompts
   * and workflow-aware exit behavior.
   */
  workflowMode?: boolean;
  workflowSystemPrompt?: string;
  workflowExitWords?: string[];
  suppressAutoIntroduction?: boolean;
  disableProcessExit?: boolean;
}

export interface HireOptions {
  name?: string;
  role?: string;
  skill?: string;
  type?: string;
  reportsTo?: string;
  chat?: boolean;
}

export interface FireOptions {
  force?: boolean;
}

export interface InitOptions {
  template?: string;
  force?: boolean;
}

export interface SetupOptions {
  /** Force re-setup even if LLM is already configured */
  force?: boolean;
}

export interface OnboardOptions {
  /** Template to use for onboarding */
  template?: string;
}

export interface SystemStatus {
  initialized: boolean;
  hasLlmConfig: boolean;
  hasAgents: boolean;
}

export interface InteractionRequest {
  requestId?: string;
  command: string;
  payload: unknown;
}

// ── Command Dispatcher ────────────────────────────────────────────────────────

/** Where a command is available. */
export interface CommandAvailability {
  cli?: boolean;
  chat?: boolean;
  cliChat?: boolean;
  tool?: boolean;
}

/** Read-only descriptor exposed by the dispatcher for discovery. */
export interface CommandDescriptor {
  key: string;
  group?: string;
  aliases?: string[];
  description: string;
  usage?: string;
  availableIn: CommandAvailability;
  path?: string[];
  help?: {
    description?: string;
    hints?: string[];
    examples?: Array<{
      value: string;
      surfaces?: Array<'cli' | 'chat' | 'tool' | 'workflow'>;
      description?: string;
    }>;
  };
  llm?: {
    description?: string;
    hints?: string[];
    examples?: string[];
    hiddenParameters?: string[];
  };
  intents?: string[];
  intentExamples?: string[];
  input?: {
    mode?: 'structured' | 'raw-tail' | 'hybrid';
    jsonSignature?: boolean;
    contextParameters?: string[];
    contextOverrideAllowlist?: string[];
    requiredAtRuntime?: string[];
  };
}

/**
 * Service-layer command dispatch interface.
 *
 * Both CLI and browser clients delegate here to execute commands by typed
 * payload. Chat slash commands are also routed through this interface, making
 * every command callable as `{ command, payload }`.
 */
export interface ICommandDispatcher {
  dispatch(key: string, params: unknown, ctx: ExecutionContext): Promise<CommandResponse<unknown>>;

  getCommands(filter?: Partial<CommandAvailability>): CommandDescriptor[];
  getCommand(key: string): CommandDescriptor | undefined;
}

export interface ToolRuntimePayloadEvent {
  toolName: string;
  outcome: 'request' | 'start' | 'result' | 'error' | 'denied';
  request?: unknown;
  /** Terminal tool phases carry the normalized command-style response envelope. */
  commandResponse?: CommandResponse;
  /** LLM-formatted representation of result — what was injected into the model's context window. */
  resultLlm?: unknown;
  denial?: ToolDenialEvent;
}

export type StreamEvent<TCommand extends string = string> =
  | {
      requestId?: string;
      toolCallId?: string;
      command: TCommand;
      kind: 'started';
      timestamp: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'status';
      timestamp: string;
      phase?: string;
      message?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'agent_info';
      timestamp: string;
      agentId?: string;
      agentName: string;
      agentRole?: string;
      developerName?: string;
      message?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'progress';
      timestamp: string;
      phase?: string;
      percent?: number;
      message?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'log';
      timestamp: string;
      level?: 'info' | 'warn' | 'error' | 'debug';
      message: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'token';
      timestamp: string;
      text: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'tool';
      timestamp: string;
      toolName: string;
      toolCallId?: string;
      toolPhase?: 'request' | 'start' | 'result' | 'error' | 'denied';
      /** Monotonic sequence assigned by server stream emission for deterministic ordering. */
      toolEventSeq?: number;
      message?: string;
      toolDenial?: ToolDenialEvent;
      toolResult?: ToolRuntimePayloadEvent;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'question';
      timestamp: string;
      questionType?: 'confirm' | 'input' | 'select' | 'password' | 'checklist';
      message: string;
      choices?: QuestionSelectChoice[];
      default?: string | boolean | string[];
      recommended?: string[];
      minSelections?: number;
      maxSelections?: number;
      allowOther?: boolean;
      otherLabel?: string;
      otherPrompt?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'handoff';
      timestamp: string;
      fromAgentId: string;
      fromAgentName?: string;
      fromAgentRole?: string;
      fromSessionId?: string;
      toAgentId: string;
      toAgentName?: string;
      toAgentRole?: string;
      toSessionId?: string;
      handoffNote?: string;
      briefingContent?: string;
      message?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'code_edit_proposal';
      timestamp: string;
      proposalId?: string;
      agentName?: string;
      description?: string;
      filesChanged?: number;
      additions?: number;
      deletions?: number;
      warnings?: string[];
      files?: Array<{
        filePath: string;
        oldContent: string;
        newContent: string;
        additions?: number;
        deletions?: number;
      }>;
      message?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'avatar-preview';
      timestamp: string;
      agentId: string;
      agentName: string;
      previewPath: string;
      imageBase64?: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'session_switched';
      timestamp: string;
      sessionId: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'session_title_updated';
      timestamp: string;
      sessionId: string;
      title: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'result';
      timestamp: string;
      data: CommandResponse<unknown>;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'error';
      timestamp: string;
      message: string;
    }
  | {
      requestId?: string;
      command: TCommand;
      kind: 'done' | 'aborted';
      timestamp: string;
    };

export interface QuestionSelectChoice {
  name: string;
  value: string;
  description?: string;
  recommended?: boolean;
}

export interface QuestionWorkflowMetadata {
  workflowId?: string;
  stepId?: string;
  questionId?: string;
  continuationToken?: string;
}

export interface QuestionInputRequest {
  message: string;
  validate?: (value: string) => true | string;
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionConfirmRequest {
  message: string;
  default?: boolean;
  /** Visual style for the confirmation prompt. 'allow' renders Allow/Deny buttons; 'confirm' (default) renders Yes/No buttons. */
  style?: 'confirm' | 'allow';
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionPasswordRequest {
  message: string;
  mask?: string;
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionSelectRequest {
  message: string;
  choices: QuestionSelectChoice[];
  default?: string;
  recommended?: string[];
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionChecklistRequest {
  message: string;
  choices: QuestionSelectChoice[];
  default?: string[];
  recommended?: string[];
  minSelections?: number;
  maxSelections?: number;
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
  workflow?: QuestionWorkflowMetadata;
}

export interface WorkflowFrame {
  workflowId: string;
  stepId: string;
  continuationToken?: string;
  question?: QuestionRequest;
  completed?: boolean;
  result?: unknown;
  error?: string;
}

// ─── Mediator runtime types ───────────────────────────────────────────────────

export interface WorkflowStateSnapshot {
  workflowId: string;
  continuationToken?: string;
  answers: Record<string, QuestionAnswerValue>;
}

export interface InteractionContext extends QuestionHandlerMap {
  emit?: (event: RuntimeStreamEvent) => void;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
  logger?: (entry: { channel: 'runtime' | 'stream'; event: unknown }) => void;
}

// ─── Question / workflow types ────────────────────────────────────────────────

export interface QuestionSelectChoice {
  name: string;
  value: string;
  description?: string;
  recommended?: boolean;
}

export interface QuestionWorkflowMetadata {
  workflowId?: string;
  stepId?: string;
  questionId?: string;
  continuationToken?: string;
}

export interface QuestionInputRequest {
  message: string;
  validate?: (value: string) => true | string;
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionConfirmRequest {
  message: string;
  default?: boolean;
  /** Visual style for the confirmation prompt. 'allow' renders Allow/Deny buttons; 'confirm' (default) renders Yes/No buttons. */
  style?: 'confirm' | 'allow';
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionPasswordRequest {
  message: string;
  mask?: string;
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionSelectRequest {
  message: string;
  choices: QuestionSelectChoice[];
  default?: string;
  recommended?: string[];
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
  workflow?: QuestionWorkflowMetadata;
}

export interface QuestionChecklistRequest {
  message: string;
  choices: QuestionSelectChoice[];
  default?: string[];
  recommended?: string[];
  minSelections?: number;
  maxSelections?: number;
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
  workflow?: QuestionWorkflowMetadata;
}

export type QuestionRequest =
  | ({ kind: 'input' } & QuestionInputRequest)
  | ({ kind: 'confirm' } & QuestionConfirmRequest)
  | ({ kind: 'password' } & QuestionPasswordRequest)
  | ({ kind: 'select' } & QuestionSelectRequest)
  | ({ kind: 'checklist' } & QuestionChecklistRequest);

export type QuestionAnswerValue = string | boolean | number | string[] | Record<string, string>;

export interface CreateAgentSetupInput {
  kind: 'agent';
  name: string;
  role: string;
  contextLevel: ContextLevel;
  reportsTo?: string;
  features?: string[];
  llm?: LlmProfile;
}

export interface ToolDenialEvent {
  kind: 'user-denied' | 'policy-denied' | 'execution-failed';
  reasonCode: string;
  message: string;
  blockedPaths?: string[];
  alternativeContexts?: Array<{ contextId: string; allowedPaths: string[] }>;
  handoffRecommendation?: {
    possible: boolean;
    requiresUserApproval: true;
    contexts: Array<{ contextId: string; allowedPaths: string[] }>;
  };
}

// ─── Streaming client (browser / transport) ───────────────────────────────────

export interface QuestionHandlerMap {
  signal: AbortSignal;
  input(request: QuestionInputRequest): Promise<string>;
  confirm(request: QuestionConfirmRequest): Promise<boolean>;
  select(request: QuestionSelectRequest): Promise<string>;
  password(request: QuestionPasswordRequest): Promise<string>;
  checklist(request: QuestionChecklistRequest): Promise<string[]>;
}

export type QuestionEventName = keyof QuestionHandlerMap;

/**
 * A stream of interaction events with typed `.on()` registration for
 * question handlers.
 *
 * Handlers registered via `.on()` are collected before iteration begins.
 * When the underlying transport encounters a question, it invokes the
 * matching handler.
 *
 * ```ts
 * for await (const event of client.stream(request, { confirm, input, signal })) { ... }
 * ```
 */

/**
 * Transport-level streaming client for the browser.
 *
 * Connects to the API server over WebSocket and yields streaming events.
 * This is NOT a service interface — it's a transport adapter consumed by the
 * web frontend.
 */
export interface IStreamingClient {
  stream<TCommand extends string = string>(
    request: InteractionRequest,
    handlers: QuestionHandlerMap
  ): AsyncIterable<StreamEvent<TCommand>>;
}
