// ---------------------------------------------------------------------------
// Wire types — shared between VS Code plugin (server) and CLI/api-server (client)
// ---------------------------------------------------------------------------

/** A single file change sent over the wire (raw content, no diff object). */
export interface IdeFileChange {
  filePath: string;
  oldContent: string;
  newContent: string;
  additions: number;
  deletions: number;
}

/** A code-edit proposal pushed from CLI/api-server to the VS Code plugin. */
export interface IdeCodeEditProposal {
  proposalId: string;
  agentName: string;
  description: string;
  files: IdeFileChange[];
}

/** Info about a client currently connected to the plugin's local WS server. */
export interface IdeClientInfo {
  clientId: string;
  workspaceRoot: string;
  connectedAt: string; // ISO string
  kind: 'cli' | 'web';
}

/** Shape of `.ai-team/.ide-server.json` written by the VS Code plugin. */
export interface IdeServerFile {
  port: number;
  workspaceRoot: string;
  pid: number;
}

// ---------------------------------------------------------------------------
// IDE edit lifecycle API contracts — shared across adapters/clients
// ---------------------------------------------------------------------------

export type IdeEditSessionState =
  | 'open'
  | 'streaming'
  | 'ready'
  | 'committed'
  | 'reverted'
  | 'closed';

export type IdeEditOrigin = 'vscode' | 'ai-team';

export interface IdeOpenDiffRequest {
  operationId: string;
  traceId?: string;
  filePath: string;
  originalContent?: string;
  editType?: 'modify' | 'create';
  agentName?: string;
  description?: string;
}

export interface IdeOpenDiffResponse {
  ok: boolean;
  sessionId: string;
  operationId: string;
  state: IdeEditSessionState;
  ideConnected: boolean;
}

export interface IdeUpdateEditRequest {
  sessionId: string;
  content: string;
  isFinal?: boolean;
}

export interface IdeUpdateEditResponse {
  ok: boolean;
  sessionId: string;
  state: IdeEditSessionState;
  additions: number;
  deletions: number;
}

export interface IdeSessionActionRequest {
  sessionId: string;
}

export interface IdeSessionAckActionRequest extends IdeSessionActionRequest {
  origin?: IdeEditOrigin;
  seq?: number;
}

export interface IdeCommitEditResponse {
  ok: boolean;
  sessionId: string;
  state: IdeEditSessionState;
  finalContent: string;
  terminalState: 'committed';
}

export interface IdeRevertEditResponse {
  ok: boolean;
  sessionId: string;
  state: IdeEditSessionState;
  terminalState: 'reverted';
}

export interface IdeResetEditResponse {
  ok: boolean;
  sessionId: string;
  state: 'closed';
}

export interface IdeEditStatusResponse {
  sessionId: string;
  operationId: string;
  traceId?: string;
  state: IdeEditSessionState;
  terminalState?: 'committed' | 'reverted';
  closedBy?: 'ack-accept' | 'ack-reject' | 'reset';
  filePath: string;
  lastOrigin?: IdeEditOrigin;
  lastSeq?: number;
  createdAt: string;
  lastUpdatedAt: string;
  additions: number;
  deletions: number;
}

// ---------------------------------------------------------------------------
// LSP — code intelligence types
// ---------------------------------------------------------------------------

export type LspOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'hover'
  | 'documentSymbol'
  | 'workspaceSymbol'
  | 'goToImplementation'
  | 'prepareCallHierarchy'
  | 'incomingCalls'
  | 'outgoingCalls'
  | 'getDiagnostics';

export interface LspLocation {
  path: string;
  line: number;
  character: number;
  endLine?: number;
  endCharacter?: number;
  preview?: string;
}

export interface LspSymbol {
  name: string;
  kind: string;
  path: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  children?: LspSymbol[];
}

export interface LspHoverResult {
  contents: string;
}

export interface LspCallHierarchyItem {
  name: string;
  kind: string;
  path: string;
  line: number;
  character: number;
  fromRanges?: Array<{ line: number; character: number; endLine: number; endCharacter: number }>;
}

export interface LspDiagnostic {
  path: string;
  line: number;
  character: number;
  endLine: number;
  endCharacter: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
  code?: string | number;
}

export type LspResult =
  | { kind: 'locations'; locations: LspLocation[] }
  | { kind: 'symbols'; symbols: LspSymbol[] }
  | { kind: 'hover'; hover: LspHoverResult }
  | { kind: 'callItems'; items: LspCallHierarchyItem[] }
  | { kind: 'diagnostics'; diagnostics: LspDiagnostic[] };

export interface LspParams {
  filePath: string;
  line?: number;
  character?: number;
  query?: string;
}

// ---------------------------------------------------------------------------
// LspProvider interface
// ---------------------------------------------------------------------------

export interface LspProvider {
  execute(operation: LspOperation, params: LspParams): Promise<LspResult>;
  isAvailable(): boolean;
}

// ---------------------------------------------------------------------------
// Protocol messages — Caller (CLI/api-server) → Plugin
// ---------------------------------------------------------------------------

export type IdeCallerMessage =
  | { type: 'register'; workspaceRoot: string; kind: 'cli' | 'web' }
  | { type: 'openFile'; filePath: string; line?: number }
  | { type: 'codeEditProposal'; proposal: IdeCodeEditProposal }
  | { type: 'lspRequest'; requestId: string; operation: LspOperation; params: LspParams }
  | { type: 'ping' };

// ---------------------------------------------------------------------------
// Protocol messages — Plugin → Caller
// ---------------------------------------------------------------------------

export type IdePluginMessage =
  | { type: 'registered'; clientId: string }
  | { type: 'rejected'; reason: string }
  | { type: 'ack'; proposalId: string; action: 'accept' | 'reject' }
  | { type: 'clientsChanged'; clients: IdeClientInfo[] }
  | { type: 'lspResponse'; requestId: string; ok: boolean; result?: LspResult; error?: string }
  | { type: 'pong' };

// ---------------------------------------------------------------------------
// IdeAdapter interface
// ---------------------------------------------------------------------------

export interface IdeAdapter {
  /** Open a file in the IDE, optionally at a specific line (1-based). */
  openFile(filePath: string, line?: number): Promise<void>;
  /** Push a code-edit proposal to the IDE so it can show keep/undo decorations. */
  notifyCodeEditProposal(proposal: IdeCodeEditProposal): Promise<void>;
  /** Whether the adapter has an active connection to the IDE. */
  isConnected(): boolean;
  /**
   * Register a handler called when the IDE user accepts or rejects a proposal.
   * Called for every ack message received from the plugin.
   */
  onAck(handler: (proposalId: string, action: 'accept' | 'reject') => void): void;
  /** LSP code-intelligence provider routed through the connected IDE. */
  readonly lsp: LspProvider;
  /** Disconnect and clean up. */
  dispose(): void;
}
