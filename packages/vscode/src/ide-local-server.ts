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
  LspOperation,
  LspParams,
  LspResult,
  LspLocation,
  LspSymbol,
  LspHoverResult,
  LspCallHierarchyItem,
  LspDiagnostic,
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
    this.eventHandlers.forEach((h) => h(event));
  }

  getPort(): number {
    return this.port;
  }

  getConnectedClients(): IdeClientInfo[] {
    return Array.from(this.clients.values()).map((c) => ({
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
          console.error(
            `[AI Team] WS path mismatch: msg="${msg.workspaceRoot}" server="${this.workspaceRoot}"`
          );
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
      case 'lspRequest':
        this.handleLspRequest(msg.requestId, msg.operation, msg.params);
        break;
      case 'ping': {
        // pong back to all (broadcast not targeted — fine for this use case)
        const pong: IdePluginMessage = { type: 'pong' };
        const payload = JSON.stringify(pong);
        this.clients.forEach((c) => {
          if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
        });
        break;
      }
      default:
        break;
    }
  }

  // ── LSP request routing ──────────────────────────────────────────────────

  private async handleLspRequest(
    requestId: string,
    operation: LspOperation,
    params: LspParams
  ): Promise<void> {
    try {
      const result = await this.executeLspOperation(operation, params);
      this.broadcastLspResponse({ type: 'lspResponse', requestId, ok: true, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.broadcastLspResponse({ type: 'lspResponse', requestId, ok: false, error: message });
    }
  }

  private async executeLspOperation(
    operation: LspOperation,
    params: LspParams
  ): Promise<LspResult> {
    const uri = vscode.Uri.file(params.filePath);
    const pos = new vscode.Position(params.line ?? 0, params.character ?? 0);

    switch (operation) {
      case 'goToDefinition': {
        const locs = await vscode.commands.executeCommand<
          (vscode.Location | vscode.LocationLink)[]
        >('vscode.executeDefinitionProvider', uri, pos);
        return { kind: 'locations', locations: await this.convertLocations(locs ?? []) };
      }
      case 'findReferences': {
        const locs = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeReferenceProvider',
          uri,
          pos
        );
        return { kind: 'locations', locations: await this.convertLocations(locs ?? []) };
      }
      case 'goToImplementation': {
        const locs = await vscode.commands.executeCommand<
          (vscode.Location | vscode.LocationLink)[]
        >('vscode.executeImplementationProvider', uri, pos);
        return { kind: 'locations', locations: await this.convertLocations(locs ?? []) };
      }
      case 'hover': {
        const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
          'vscode.executeHoverProvider',
          uri,
          pos
        );
        return { kind: 'hover', hover: this.convertHover(hovers ?? []) };
      }
      case 'documentSymbol': {
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
          'vscode.executeDocumentSymbolProvider',
          uri
        );
        return {
          kind: 'symbols',
          symbols: this.convertDocumentSymbols(symbols ?? [], params.filePath),
        };
      }
      case 'workspaceSymbol': {
        const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
          'vscode.executeWorkspaceSymbolProvider',
          params.query ?? ''
        );
        return { kind: 'symbols', symbols: this.convertSymbolInformations(symbols ?? []) };
      }
      case 'prepareCallHierarchy': {
        const items = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
          'vscode.prepareCallHierarchy',
          uri,
          pos
        );
        return { kind: 'callItems', items: this.convertCallHierarchyItems(items ?? []) };
      }
      case 'incomingCalls': {
        const prepared = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
          'vscode.prepareCallHierarchy',
          uri,
          pos
        );
        if (!prepared?.length) return { kind: 'callItems', items: [] };
        const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>(
          'vscode.provideIncomingCalls',
          prepared[0]
        );
        return { kind: 'callItems', items: this.convertIncomingCalls(calls ?? []) };
      }
      case 'outgoingCalls': {
        const prepared = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>(
          'vscode.prepareCallHierarchy',
          uri,
          pos
        );
        if (!prepared?.length) return { kind: 'callItems', items: [] };
        const calls = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>(
          'vscode.provideOutgoingCalls',
          prepared[0]
        );
        return { kind: 'callItems', items: this.convertOutgoingCalls(calls ?? []) };
      }
      case 'getDiagnostics': {
        const diagnostics = vscode.languages.getDiagnostics(uri);
        return {
          kind: 'diagnostics',
          diagnostics: this.convertDiagnostics(diagnostics, params.filePath),
        };
      }
      default:
        throw new Error(`Unknown LSP operation: ${operation}`);
    }
  }

  private async convertLocations(
    locs: (vscode.Location | vscode.LocationLink)[]
  ): Promise<LspLocation[]> {
    const results: LspLocation[] = [];
    for (const loc of locs.slice(0, 50)) {
      const range = 'targetRange' in loc ? loc.targetRange : loc.range;
      const uri = 'targetUri' in loc ? loc.targetUri : loc.uri;
      const filePath = uri.fsPath;

      let preview: string | undefined;
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        preview = doc.lineAt(range.start.line).text.trim();
      } catch {
        // file may not be openable
      }

      results.push({
        path: filePath,
        line: range.start.line,
        character: range.start.character,
        endLine: range.end.line,
        endCharacter: range.end.character,
        preview,
      });
    }
    return results;
  }

  private convertHover(hovers: vscode.Hover[]): LspHoverResult {
    const parts: string[] = [];
    for (const hover of hovers) {
      for (const content of hover.contents) {
        if (typeof content === 'string') {
          parts.push(content);
        } else if (content instanceof vscode.MarkdownString) {
          parts.push(content.value);
        } else if ('language' in content) {
          parts.push(`\`\`\`${content.language}\n${content.value}\n\`\`\``);
        }
      }
    }
    return { contents: parts.join('\n\n') };
  }

  private convertDocumentSymbols(symbols: vscode.DocumentSymbol[], filePath: string): LspSymbol[] {
    const convert = (sym: vscode.DocumentSymbol): LspSymbol => ({
      name: sym.name,
      kind: vscode.SymbolKind[sym.kind] ?? String(sym.kind),
      path: filePath,
      line: sym.range.start.line,
      character: sym.range.start.character,
      endLine: sym.range.end.line,
      endCharacter: sym.range.end.character,
      children: sym.children?.length ? sym.children.map(convert) : undefined,
    });
    return symbols.slice(0, 200).map(convert);
  }

  private convertSymbolInformations(symbols: vscode.SymbolInformation[]): LspSymbol[] {
    return symbols.slice(0, 200).map((sym) => ({
      name: sym.name,
      kind: vscode.SymbolKind[sym.kind] ?? String(sym.kind),
      path: sym.location.uri.fsPath,
      line: sym.location.range.start.line,
      character: sym.location.range.start.character,
      endLine: sym.location.range.end.line,
      endCharacter: sym.location.range.end.character,
    }));
  }

  private convertCallHierarchyItems(items: vscode.CallHierarchyItem[]): LspCallHierarchyItem[] {
    return items.slice(0, 50).map((item) => ({
      name: item.name,
      kind: vscode.SymbolKind[item.kind] ?? String(item.kind),
      path: item.uri.fsPath,
      line: item.range.start.line,
      character: item.range.start.character,
    }));
  }

  private convertIncomingCalls(calls: vscode.CallHierarchyIncomingCall[]): LspCallHierarchyItem[] {
    return calls.slice(0, 50).map((call) => ({
      name: call.from.name,
      kind: vscode.SymbolKind[call.from.kind] ?? String(call.from.kind),
      path: call.from.uri.fsPath,
      line: call.from.range.start.line,
      character: call.from.range.start.character,
      fromRanges: call.fromRanges.map((r) => ({
        line: r.start.line,
        character: r.start.character,
        endLine: r.end.line,
        endCharacter: r.end.character,
      })),
    }));
  }

  private convertOutgoingCalls(calls: vscode.CallHierarchyOutgoingCall[]): LspCallHierarchyItem[] {
    return calls.slice(0, 50).map((call) => ({
      name: call.to.name,
      kind: vscode.SymbolKind[call.to.kind] ?? String(call.to.kind),
      path: call.to.uri.fsPath,
      line: call.to.range.start.line,
      character: call.to.range.start.character,
      fromRanges: call.fromRanges.map((r) => ({
        line: r.start.line,
        character: r.start.character,
        endLine: r.end.line,
        endCharacter: r.end.character,
      })),
    }));
  }

  private convertDiagnostics(diagnostics: vscode.Diagnostic[], filePath: string): LspDiagnostic[] {
    const severityMap: Record<number, LspDiagnostic['severity']> = {
      [vscode.DiagnosticSeverity.Error]: 'error',
      [vscode.DiagnosticSeverity.Warning]: 'warning',
      [vscode.DiagnosticSeverity.Information]: 'info',
      [vscode.DiagnosticSeverity.Hint]: 'hint',
    };
    return diagnostics.slice(0, 20).map((d) => {
      let code: string | number | undefined;
      if (d.code != null) {
        code = typeof d.code === 'object' ? String(d.code.value) : d.code;
      }
      return {
        path: filePath,
        line: d.range.start.line,
        character: d.range.start.character,
        endLine: d.range.end.line,
        endCharacter: d.range.end.character,
        severity: severityMap[d.severity] ?? 'info',
        message: d.message,
        source: d.source,
        code,
      };
    });
  }

  private broadcastLspResponse(msg: IdePluginMessage): void {
    const payload = JSON.stringify(msg);
    this.clients.forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload);
    });
  }

  /** Send ack to all connected clients (e.g. user clicked Keep/Undo). */
  broadcastAck(proposalId: string, action: 'accept' | 'reject'): void {
    const msg: IdePluginMessage = { type: 'ack', proposalId, action };
    const payload = JSON.stringify(msg);
    this.clients.forEach((c) => {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(payload);
      }
    });
  }

  private broadcastClientsChanged(): void {
    const clients = this.getConnectedClients();
    const msg: IdePluginMessage = { type: 'clientsChanged', clients };
    const payload = JSON.stringify(msg);
    this.clients.forEach((c) => {
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
    this.clients.forEach((c) => c.ws.terminate());
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
        server.close((err) => (err ? reject(err) : resolve(port)));
      });
      server.on('error', reject);
    });
  }
}
