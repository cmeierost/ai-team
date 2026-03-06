import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  IdeCallerMessage,
  IdePluginMessage,
  IdeClientInfo,
  IdeCodeEditProposal,
} from '@ai-team/ide-interface';

export type IdeLocalServerEvent =
  | { kind: 'clientsChanged'; clients: IdeClientInfo[] }
  | { kind: 'openFile'; filePath: string; line?: number }
  | { kind: 'codeEditProposal'; proposal: IdeCodeEditProposal };

/** A client connection tracked by the local server. */
interface ConnectedClient {
  clientId: string;
  workspaceRoot: string;
  connectedAt: string;
  kind: 'cli' | 'web';
  ws: WebSocket;
}

const IDE_SERVER_FILE = '.ide-server.json';

function normalizePath(p: string): string {
  // Replace forward slashes with backslashes, remove trailing separator, lowercase
  let n = p.replace(/\//g, '\\');
  if (n.endsWith('\\')) n = n.slice(0, -1);
  return process.platform === 'win32' ? n.toLowerCase() : n;
}

function pathsMatch(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}

/**
 * Local WebSocket server that lives inside the VS Code extension.
 * CLI and api-server processes connect to it to push file-open requests
 * and code-edit proposals.
 */
export class IdeLocalServer {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ConnectedClient>();
  private clientCounter = 0;
  private port = 0;
  private serverFilePath: string;
  private eventHandlers: Array<(event: IdeLocalServerEvent) => void> = [];

  constructor(private readonly workspaceRoot: string) {
    this.serverFilePath = path.join(workspaceRoot, '.ai-team', IDE_SERVER_FILE);
  }

  on(handler: (event: IdeLocalServerEvent) => void): void {
    this.eventHandlers.push(handler);
  }

  private emit(event: IdeLocalServerEvent): void {
    this.eventHandlers.forEach(h => h(event));
  }

  getPort(): number {
    return this.port;
  }

  getConnectedClients(): IdeClientInfo[] {
    return Array.from(this.clients.values()).map(c => ({
      clientId: c.clientId,
      workspaceRoot: c.workspaceRoot,
      connectedAt: c.connectedAt,
      kind: c.kind,
    }));
  }

  /** Find a free port and start the WS server, then write the server file. */
  async start(): Promise<void> {
    this.port = await this.findFreePort();
    this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    this.writeServerFile();
  }

  private handleConnection(ws: WebSocket): void {
    let registered = false;
    let clientId = '';

    // Expect register as first message; drop anything that doesn't pass
    ws.once('message', (data: Buffer) => {
      try {
        const msg: IdeCallerMessage = JSON.parse(data.toString());
        if (msg.type !== 'register') {
          const reply: IdePluginMessage = { type: 'rejected', reason: 'Expected register message' };
          ws.send(JSON.stringify(reply));
          ws.close();
          return;
        }
        if (!pathsMatch(msg.workspaceRoot, this.workspaceRoot)) {
          console.error(`[AI Team] WS path mismatch: msg="${msg.workspaceRoot}" server="${this.workspaceRoot}"`);
          const reply: IdePluginMessage = { type: 'rejected', reason: 'Workspace root mismatch' };
          ws.send(JSON.stringify(reply));
          ws.close();
          return;
        }

        clientId = `${msg.kind}-${++this.clientCounter}`;
        const client: ConnectedClient = {
          clientId,
          workspaceRoot: msg.workspaceRoot,
          connectedAt: new Date().toISOString(),
          kind: msg.kind,
          ws,
        };
        this.clients.set(clientId, client);
        registered = true;

        const reply: IdePluginMessage = { type: 'registered', clientId };
        ws.send(JSON.stringify(reply));
        this.broadcastClientsChanged();

        // Handle subsequent messages
        ws.on('message', (data: Buffer) => {
          try {
            const subsequent: IdeCallerMessage = JSON.parse(data.toString());
            this.handleMessage(subsequent);
          } catch {
            // ignore malformed
          }
        });
      } catch {
        ws.close();
      }
    });

    ws.on('close', () => {
      if (registered && clientId) {
        this.clients.delete(clientId);
        this.broadcastClientsChanged();
        this.emit({ kind: 'clientsChanged', clients: this.getConnectedClients() });
      }
    });

    ws.on('error', () => {
      if (registered && clientId) {
        this.clients.delete(clientId);
        this.broadcastClientsChanged();
      }
    });
  }

  private handleMessage(msg: IdeCallerMessage): void {
    switch (msg.type) {
      case 'openFile':
        this.emit({ kind: 'openFile', filePath: msg.filePath, line: msg.line });
        break;
      case 'codeEditProposal':
        this.emit({ kind: 'codeEditProposal', proposal: msg.proposal });
        break;
      case 'ping': {
        // pong back to all (broadcast not targeted — fine for this use case)
        const pong: IdePluginMessage = { type: 'pong' };
        const payload = JSON.stringify(pong);
        this.clients.forEach(c => {
          if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
        });
        break;
      }
      default:
        break;
    }
  }

  /** Send ack to all connected clients (e.g. user clicked Keep/Undo). */
  broadcastAck(proposalId: string, action: 'accept' | 'reject'): void {
    const msg: IdePluginMessage = { type: 'ack', proposalId, action };
    const payload = JSON.stringify(msg);
    this.clients.forEach(c => {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
      }
    });
  }

  private broadcastClientsChanged(): void {
    const clients = this.getConnectedClients();
    const msg: IdePluginMessage = { type: 'clientsChanged', clients };
    const payload = JSON.stringify(msg);
    this.clients.forEach(c => {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
    });
    this.emit({ kind: 'clientsChanged', clients });
  }

  private writeServerFile(): void {
    const data = JSON.stringify({
      port: this.port,
      workspaceRoot: this.workspaceRoot,
      pid: process.pid,
    });
    try {
      fs.writeFileSync(this.serverFilePath, data, 'utf8');
    } catch {
      vscode.window.showWarningMessage('AI Team: could not write .ai-team/.ide-server.json');
    }
  }

  stop(): void {
    this.clients.forEach(c => c.ws.terminate());
    this.clients.clear();
    this.wss?.close();
    this.wss = null;
    try {
      if (fs.existsSync(this.serverFilePath)) {
        fs.unlinkSync(this.serverFilePath);
      }
    } catch {
      // best-effort
    }
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        server.close(err => (err ? reject(err) : resolve(port)));
      });
      server.on('error', reject);
    });
  }
}
