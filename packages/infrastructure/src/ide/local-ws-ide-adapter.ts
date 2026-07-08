import WebSocket from 'ws';
import type {
  IdeAdapter,
  IdeCallerMessage,
  IdeCodeEditProposal,
  IdePluginMessage,
  LspOperation,
  LspParams,
  LspProvider,
  LspResult,
} from '@ai-team/core';

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
        return resolve();
      }
      this.ws.send(JSON.stringify(msg), (err?: Error) => (err ? reject(err) : resolve()));
    });
  }

  private executeLsp(operation: LspOperation, params: LspParams): Promise<LspResult> {
    if (!this._connected || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('No IDE connected'));
    }

    const requestId = `lsp-${++this._lspRequestCounter}`;
    const lspTimeoutMs = 15_000;

    return new Promise<LspResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.lspPendingRequests.delete(requestId);
        reject(new Error(`LSP ${operation} timed out after ${lspTimeoutMs}ms`));
      }, lspTimeoutMs);

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
    this.lspPendingRequests.forEach((pending) => {
      pending.reject(new Error(reason));
    });
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
