import * as vscode from 'vscode';
import type { IdeClientInfo } from '@ai-team/ide-interface';
import type { IdeLocalServer } from '../ide-local-server';

type ConnectionNodeKind = 'server' | 'client-group' | 'client' | 'placeholder';

export class ConnectionNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly nodeKind: ConnectionNodeKind,
    public readonly clientInfo?: IdeClientInfo,
  ) {
    super(label, collapsibleState);
  }
}

/** Tree view showing the local WS server status and all connected clients. */
export class ConnectionStatusProvider implements vscode.TreeDataProvider<ConnectionNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private server: IdeLocalServer | null = null;
  private initialized = false;
  private clients: IdeClientInfo[] = [];

  setServer(server: IdeLocalServer): void {
    this.server = server;
    this.initialized = true;
    server.on((event: import('../ide-local-server').IdeLocalServerEvent) => {
      if (event.kind === 'clientsChanged') {
        this.clients = event.clients;
        this._onDidChangeTreeData.fire();
      }
    });
    this._onDidChangeTreeData.fire();
  }

  setUninitialized(): void {
    this.server = null;
    this.initialized = false;
    this.clients = [];
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ConnectionNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ConnectionNode): ConnectionNode[] {
    if (!element) {
      return this.getRootNodes();
    }
    if (element.nodeKind === 'client-group') {
      return this.getClientNodes();
    }
    return [];
  }

  private getRootNodes(): ConnectionNode[] {
    if (!this.initialized) {
      const placeholder = new ConnectionNode(
        'Run `ait init` to initialize this workspace',
        vscode.TreeItemCollapsibleState.None,
        'placeholder',
      );
      placeholder.iconPath = new vscode.ThemeIcon('info');
      return [placeholder];
    }

    const port = this.server?.getPort() ?? 0;
    const serverNode = new ConnectionNode(
      `Local Server  :${port}`,
      vscode.TreeItemCollapsibleState.None,
      'server',
    );
    serverNode.iconPath = new vscode.ThemeIcon('server-process', new vscode.ThemeColor('testing.iconPassed'));
    serverNode.tooltip = `AI Team IDE server running on 127.0.0.1:${port}`;
    serverNode.description = 'running';

    const clientCount = this.clients.length;
    const clientGroup = new ConnectionNode(
      'Connected Clients',
      clientCount > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed,
      'client-group',
    );
    clientGroup.iconPath = new vscode.ThemeIcon('plug');
    clientGroup.description = clientCount > 0 ? `${clientCount}` : 'none';

    return [serverNode, clientGroup];
  }

  private getClientNodes(): ConnectionNode[] {
    if (this.clients.length === 0) {
      const none = new ConnectionNode(
        'No active connections',
        vscode.TreeItemCollapsibleState.None,
        'placeholder',
      );
      none.iconPath = new vscode.ThemeIcon('circle-slash');
      return [none];
    }
    return this.clients.map(c => {
      const node = new ConnectionNode(
        c.clientId,
        vscode.TreeItemCollapsibleState.None,
        'client',
        c,
      );
      node.iconPath = new vscode.ThemeIcon(c.kind === 'cli' ? 'terminal' : 'browser');
      node.tooltip = new vscode.MarkdownString(
        `**${c.kind.toUpperCase()}** client\n\nConnected: ${new Date(c.connectedAt).toLocaleTimeString()}`,
      );
      node.description = new Date(c.connectedAt).toLocaleTimeString();
      return node;
    });
  }
}
