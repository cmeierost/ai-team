import * as fs from 'node:fs';
import * as path from 'node:path';
import WebSocket from 'ws';
import {
  IdeAdapter,
  IdeCodeEditProposal,
  LspProvider,
  LspOperation,
  LspParams,
  LspResult,
  IdePluginMessage,
  IdeCallerMessage,
  IdeServerFile,
} from '@ai-team/core';

export class NoopLspProvider implements LspProvider {
  async execute(_operation: LspOperation, _params: LspParams): Promise<LspResult> {
    return { kind: 'locations', locations: [] };
  }
  isAvailable(): boolean {
    return false;
  }
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
  private readonly ackHandlers: Array<(proposalId: string, action: 'accept' | 'reject') => void> =
    [];
  private _connected = false;
  private readonly lspPendingRequests = new Map<
    string,
    {
      resolve: (result: LspResult) => void;
      reject: (err: Error) => void;
    }
  >();
  private _lspRequestCounter = 0;

  readonly lsp: LspProvider;

  constructor(private readonly ws: WebSocket) {
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
          this.ackHandlers.forEach((h) => h(msg.proposalId, msg.action));
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
      this.ws.send(JSON.stringify(msg), (err?: Error) => (err ? reject(err) : resolve()));
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
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      const msg: IdeCallerMessage = { type: 'lspRequest', requestId, operation, params };
      this.ws.send(JSON.stringify(msg), (err?: Error) => {
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
  kind: 'cli' | 'web' = 'cli'
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
  return new Promise<IdeAdapter>((resolve) => {
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
