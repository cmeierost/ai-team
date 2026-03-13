import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IdeLocalServer } from './ide-local-server';
import { ConnectionStatusProvider } from './views/connection-status-provider';
import { PendingChangesProvider, ProposalItem } from './views/pending-changes-provider';
import { CodeEditDecorationManager } from './decorations/code-edit-decorator';
import { PendingChangesPanel } from './panels/pending-changes-panel';

/** Reads ide.webAppUrl from .ai-team/config.json, falls back to VS Code setting, then default. */
function getWebAppUrl(workspaceRoot: string): string {
  try {
    const configPath = path.join(workspaceRoot, '.ai-team', 'config.json');
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (cfg?.ide?.webAppUrl) return cfg.ide.webAppUrl;
    }
  } catch { /* ignore */ }
  const setting = vscode.workspace.getConfiguration('ai-team').get<string>('webAppUrl');
  return setting || 'http://localhost:3000';
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) return;

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');

  const connectionProvider = new ConnectionStatusProvider();
  vscode.window.createTreeView('ai-team.connectionsView', {
    treeDataProvider: connectionProvider,
    showCollapseAll: false,
  });

  const pendingChangesProvider = new PendingChangesProvider();
  vscode.window.createTreeView('ai-team.pendingChangesView', {
    treeDataProvider: pendingChangesProvider,
    showCollapseAll: false,
  });

  // ── Commands available regardless of initialization state ─────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('ai-team.openWebApp', () => {
      const url = getWebAppUrl(workspaceRoot);
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  // ── Guard: no .ai-team directory ──────────────────────────────────────────
  if (!fs.existsSync(aiTeamDir)) {
    connectionProvider.setUninitialized();

    // Register init command only — everything else is deferred
    context.subscriptions.push(
      vscode.commands.registerCommand('ai-team.initWorkspace', () => {
        vscode.window.showInformationMessage(
          'Run `ait init` in the terminal to initialize this workspace.',
        );
      }),
    );

    // Watch for .ai-team to appear, then re-activate
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(workspaceRoot, '.ai-team/**'),
    );
    context.subscriptions.push(watcher);
    watcher.onDidCreate(async () => {
      if (fs.existsSync(aiTeamDir)) {
        watcher.dispose();
        await activateFull(context, workspaceRoot, connectionProvider, pendingChangesProvider);
      }
    });
    return;
  }

  // ── Full activation ────────────────────────────────────────────────────────
  await activateFull(context, workspaceRoot, connectionProvider, pendingChangesProvider);
}

async function activateFull(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  connectionProvider: ConnectionStatusProvider,
  pendingChangesProvider: PendingChangesProvider,
): Promise<void> {
  const diffContentProvider = new (class implements vscode.TextDocumentContentProvider {
    provideTextDocumentContent(uri: vscode.Uri): string {
      return Buffer.from(uri.query, 'base64').toString('utf-8');
    }
  })();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      CodeEditDecorationManager.DIFF_URI_SCHEME,
      diffContentProvider,
    ),
  );

  // Start local WS server
  const server = new IdeLocalServer(workspaceRoot);
  await server.start();
  context.subscriptions.push({ dispose: () => server.stop() });

  // Wire connection status tree
  connectionProvider.setServer(server);

  // Code-edit decoration manager
  const decoratorManager = new CodeEditDecorationManager(context, server);
  context.subscriptions.push(decoratorManager);

  function refreshPendingTree(): void {
    pendingChangesProvider.setProposals(decoratorManager.getPendingProposals());
    PendingChangesPanel.refresh(decoratorManager.getPendingProposals());
  }

  // Any time the decorator resolves a proposal (accept/reject/manual edit), refresh the tree
  context.subscriptions.push(decoratorManager.onProposalResolved(() => refreshPendingTree()));

  // Route server events
  server.on(async event => {
    if (event.kind === 'openFile') {
      try {
        const uri = vscode.Uri.file(event.filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const opts: vscode.TextDocumentShowOptions = {};
        if (event.line !== undefined) {
          const pos = new vscode.Position(Math.max(0, event.line - 1), 0);
          opts.selection = new vscode.Range(pos, pos);
        }
        await vscode.window.showTextDocument(doc, opts);
      } catch {
        vscode.window.showErrorMessage(`AI Team: could not open file ${event.filePath}`);
      }
    } else if (event.kind === 'codeEditProposal') {
      await decoratorManager.applyProposal(event.proposal);
      refreshPendingTree();
    }
  });

  // ── Commands ──────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('ai-team.initWorkspace', () => {
      vscode.window.showInformationMessage('Workspace is already initialized.');
    }),

    vscode.commands.registerCommand('ai-team.openWebApp', () => {
      const url = getWebAppUrl(workspaceRoot);
      vscode.env.openExternal(vscode.Uri.parse(url));
    }),

    // CodeLens keep/undo (called with proposalId string) — refresh via onProposalResolved event
    vscode.commands.registerCommand('ai-team.acceptChange', (proposalId: string) => {
      decoratorManager.acceptProposal(proposalId);
    }),

    vscode.commands.registerCommand('ai-team.rejectChange', (proposalId: string) => {
      decoratorManager.rejectProposal(proposalId);
    }),

    // Tree view inline keep/undo (called with ProposalItem)
    vscode.commands.registerCommand('ai-team.acceptProposal', (item: ProposalItem) => {
      decoratorManager.acceptProposal(item.proposal.proposalId);
    }),

    vscode.commands.registerCommand('ai-team.rejectProposal', (item: ProposalItem) => {
      decoratorManager.rejectProposal(item.proposal.proposalId);
    }),

    // Tree row click / inline diff button — receives primitives to avoid circular JSON
    vscode.commands.registerCommand('ai-team.showFileDiff', async (filePath: string, proposalId: string) => {
      await decoratorManager.openDiffForFile(proposalId, filePath);
    }),

    vscode.commands.registerCommand('ai-team.showPendingChanges', () => {
      PendingChangesPanel.createOrShow(context, decoratorManager);
    }),
  );
}

export function deactivate(): void {
  // Disposables registered on context.subscriptions are cleaned up by VS Code automatically.
}
