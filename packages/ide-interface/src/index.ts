import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';

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

/** @deprecated Use IdeFileChange instead */
export type IdeCodeEditFile = IdeFileChange;

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

export type IdeEditSessionState = 'open' | 'streaming' | 'ready' | 'committed' | 'reverted' | 'closed';

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
  | { kind: 'symbols';   symbols: LspSymbol[] }
  | { kind: 'hover';     hover: LspHoverResult }
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

export class NoopLspProvider implements LspProvider {
  async execute(_operation: LspOperation, _params: LspParams): Promise<LspResult> {
    return { kind: 'locations', locations: [] };
  }
  isAvailable(): boolean {
    return false;
  }
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

// ---------------------------------------------------------------------------
// NoopIdeAdapter — used when no IDE is connected
// ---------------------------------------------------------------------------

export class NoopIdeAdapter implements IdeAdapter {
  readonly lsp: LspProvider = new NoopLspProvider();

  openFile(_filePath: string, _line?: number): Promise<void> {
    return Promise.resolve();
  }
  notifyCodeEditProposal(_proposal: IdeCodeEditProposal): Promise<void> {
    return Promise.resolve();
  }
  isConnected(): boolean {
    return false;
  }
  onAck(_handler: (proposalId: string, action: 'accept' | 'reject') => void): void {
    // no-op
  }
  dispose(): void {
    // no-op
  }
}

// ---------------------------------------------------------------------------
// LocalWsIdeAdapter — connects to the plugin's local WS server
// ---------------------------------------------------------------------------

export class LocalWsIdeAdapter implements IdeAdapter {
  private ws: WebSocket;
  private ackHandlers: Array<(proposalId: string, action: 'accept' | 'reject') => void> = [];
  private _connected = false;
  private lspPendingRequests = new Map<string, {
    resolve: (result: LspResult) => void;
    reject: (err: Error) => void;
  }>();
  private _lspRequestCounter = 0;

  readonly lsp: LspProvider;

  constructor(ws: WebSocket) {
    this.ws = ws;
    this._connected = ws.readyState === WebSocket.OPEN;

    // Create WsLspProvider bound to this adapter
    const adapter = this;
    this.lsp = {
      async execute(operation: LspOperation, params: LspParams): Promise<LspResult> {
        return adapter.executeLsp(operation, params);
      },
      isAvailable(): boolean {
        return adapter._connected && adapter.ws.readyState === WebSocket.OPEN;
      },
    };

    ws.on('message', (data: Buffer) => {
      try {
        const msg: IdePluginMessage = JSON.parse(data.toString());
        if (msg.type === 'ack') {
          this.ackHandlers.forEach(h => h(msg.proposalId, msg.action));
        } else if (msg.type === 'lspResponse') {
          const pending = this.lspPendingRequests.get(msg.requestId);
          if (pending) {
            this.lspPendingRequests.delete(msg.requestId);
            if (msg.ok && msg.result) {
              pending.resolve(msg.result);
            } else {
              pending.reject(new Error(msg.error ?? 'LSP request failed'));
            }
          }
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      this._connected = false;
      this.rejectPendingLsp('IDE connection closed');
    });

    ws.on('error', () => {
      this._connected = false;
      this.rejectPendingLsp('IDE connection error');
    });
  }

  private send(msg: IdeCallerMessage): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._connected || this.ws.readyState !== WebSocket.OPEN) {
        return resolve(); // best-effort, never throw
      }
      this.ws.send(JSON.stringify(msg), err => (err ? reject(err) : resolve()));
    });
  }

  private executeLsp(operation: LspOperation, params: LspParams): Promise<LspResult> {
    if (!this._connected || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('No IDE connected'));
    }

    const requestId = `lsp-${++this._lspRequestCounter}`;
    const LSP_TIMEOUT_MS = 15_000;

    return new Promise<LspResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.lspPendingRequests.delete(requestId);
        reject(new Error(`LSP ${operation} timed out after ${LSP_TIMEOUT_MS}ms`));
      }, LSP_TIMEOUT_MS);

      this.lspPendingRequests.set(requestId, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject:  (err)    => { clearTimeout(timer); reject(err); },
      });

      const msg: IdeCallerMessage = { type: 'lspRequest', requestId, operation, params };
      this.ws.send(JSON.stringify(msg), (err) => {
        if (err) {
          clearTimeout(timer);
          this.lspPendingRequests.delete(requestId);
          reject(err);
        }
      });
    });
  }

  private rejectPendingLsp(reason: string): void {
    for (const [id, pending] of this.lspPendingRequests) {
      pending.reject(new Error(reason));
    }
    this.lspPendingRequests.clear();
  }

  openFile(filePath: string, line?: number): Promise<void> {
    return this.send({ type: 'openFile', filePath, line });
  }

  notifyCodeEditProposal(proposal: IdeCodeEditProposal): Promise<void> {
    return this.send({ type: 'codeEditProposal', proposal });
  }

  isConnected(): boolean {
    return this._connected && this.ws.readyState === WebSocket.OPEN;
  }

  onAck(handler: (proposalId: string, action: 'accept' | 'reject') => void): void {
    this.ackHandlers.push(handler);
  }

  dispose(): void {
    this._connected = false;
    this.rejectPendingLsp('Adapter disposed');
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — reads .ai-team/.ide-server.json and connects
// ---------------------------------------------------------------------------

const IDE_SERVER_FILE = '.ide-server.json';
const CONNECT_TIMEOUT_MS = 1500;

/**
 * Returns a connected `LocalWsIdeAdapter` if the VS Code plugin is running for
 * this workspace, or a `NoopIdeAdapter` if it's not (silently).
 *
 * @param workspaceRoot  Absolute path to the workspace root.
 * @param kind           Caller identity shown in the plugin's connections view.
 */
export async function createIdeAdapter(
  workspaceRoot: string,
  kind: 'cli' | 'web' = 'cli',
): Promise<IdeAdapter> {
  const serverFilePath = path.join(workspaceRoot, '.ai-team', IDE_SERVER_FILE);

  let serverInfo: IdeServerFile;
  try {
    const raw = fs.readFileSync(serverFilePath, 'utf8');
    serverInfo = JSON.parse(raw) as IdeServerFile;
  } catch {
    return new NoopIdeAdapter();
  }

  // Guard: check that the pid is still alive (stale file guard).
  // On Windows, process.kill(pid, 0) throws EPERM if the process exists but is
  // owned by a different user/security context (e.g. VS Code). Treat EPERM as
  // "alive"; only ESRCH means "no such process".
  try {
    process.kill(serverInfo.pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
      return new NoopIdeAdapter();
    }
    // EPERM → process exists, continue
  }

  // Guard: workspaceRoot in file must match ours (normalize separators + case on Windows)
  function normalizePath(p: string): string {
    let n = p.replace(/\//g, '\\');
    if (n.endsWith('\\')) n = n.slice(0, -1);
    return process.platform === 'win32' ? n.toLowerCase() : n;
  }
  if (normalizePath(serverInfo.workspaceRoot) !== normalizePath(workspaceRoot)) {
    return new NoopIdeAdapter();
  }

  // Attempt WS connection
  return new Promise<IdeAdapter>(resolve => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`);
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve(new NoopIdeAdapter());
    }, CONNECT_TIMEOUT_MS);

    ws.once('error', () => {
      clearTimeout(timeout);
      resolve(new NoopIdeAdapter());
    });

    ws.once('open', () => {
      // Send register handshake
      const registerMsg: IdeCallerMessage = { type: 'register', workspaceRoot, kind };
      ws.send(JSON.stringify(registerMsg));

      // Wait for registered | rejected
      ws.once('message', (data: Buffer) => {
        clearTimeout(timeout);
        try {
          const reply: IdePluginMessage = JSON.parse(data.toString());
          if (reply.type === 'registered') {
            resolve(new LocalWsIdeAdapter(ws));
          } else {
            ws.close();
            resolve(new NoopIdeAdapter());
          }
        } catch {
          ws.close();
          resolve(new NoopIdeAdapter());
        }
      });
    });
  });
}
