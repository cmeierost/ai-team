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
// Protocol messages — Caller (CLI/api-server) → Plugin
// ---------------------------------------------------------------------------

export type IdeCallerMessage =
  | { type: 'register'; workspaceRoot: string; kind: 'cli' | 'web' }
  | { type: 'openFile'; filePath: string; line?: number }
  | { type: 'codeEditProposal'; proposal: IdeCodeEditProposal }
  | { type: 'ping' };

// ---------------------------------------------------------------------------
// Protocol messages — Plugin → Caller
// ---------------------------------------------------------------------------

export type IdePluginMessage =
  | { type: 'registered'; clientId: string }
  | { type: 'rejected'; reason: string }
  | { type: 'ack'; proposalId: string; action: 'accept' | 'reject' }
  | { type: 'clientsChanged'; clients: IdeClientInfo[] }
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
  /** Disconnect and clean up. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// NoopIdeAdapter — used when no IDE is connected
// ---------------------------------------------------------------------------

export class NoopIdeAdapter implements IdeAdapter {
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

  constructor(ws: WebSocket) {
    this.ws = ws;
    this._connected = ws.readyState === WebSocket.OPEN;

    ws.on('message', (data: Buffer) => {
      try {
        const msg: IdePluginMessage = JSON.parse(data.toString());
        if (msg.type === 'ack') {
          this.ackHandlers.forEach(h => h(msg.proposalId, msg.action));
        }
      } catch {
        // ignore malformed messages
      }
    });

    ws.on('close', () => {
      this._connected = false;
    });

    ws.on('error', () => {
      this._connected = false;
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
