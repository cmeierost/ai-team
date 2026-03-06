import * as vscode from 'vscode';
import type { IdeCodeEditProposal } from '@ai-team/ide-interface';
import type { CodeEditDecorationManager } from '../decorations/code-edit-decorator';

/** Side panel listing all pending AI code-edit proposals. */
export class PendingChangesPanel {
  private static current: PendingChangesPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(
    context: vscode.ExtensionContext,
    decoratorManager: CodeEditDecorationManager,
  ): void {
    if (PendingChangesPanel.current) {
      PendingChangesPanel.current.panel.reveal();
      PendingChangesPanel.current.update(decoratorManager.getPendingProposals());
      return;
    }
    PendingChangesPanel.current = new PendingChangesPanel(context, decoratorManager);
  }

  /** Refresh the panel if it is currently open. No-op otherwise. */
  static refresh(proposals: IdeCodeEditProposal[]): void {
    PendingChangesPanel.current?.update(proposals);
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly decoratorManager: CodeEditDecorationManager,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'aiTeamPendingChanges',
      'AI Team — Pending Changes',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true },
    );

    this.panel.onDidDispose(() => {
      PendingChangesPanel.current = undefined;
      this.dispose();
    }, null, this.disposables);

    this.panel.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'accept') decoratorManager.acceptProposal(msg.proposalId);
      else if (msg.command === 'reject') decoratorManager.rejectProposal(msg.proposalId);
      this.update(decoratorManager.getPendingProposals());
    }, null, this.disposables);

    this.update(decoratorManager.getPendingProposals());
  }

  update(proposals: IdeCodeEditProposal[]): void {
    this.panel.webview.html = this.buildHtml(proposals);
  }

  private buildHtml(proposals: IdeCodeEditProposal[]): string {
    const rows = proposals.length === 0
      ? '<p style="color:var(--vscode-descriptionForeground)">No pending changes.</p>'
      : proposals.map(p => `
        <div class="proposal">
          <div class="header">
            <span class="agent">${escapeHtml(p.agentName)}</span>
            <span class="desc">${escapeHtml(p.description)}</span>
          </div>
          <div class="files">${p.files.map(f => `<div class="file">
            <span class="additions">+${f.additions}</span>
            <span class="deletions">-${f.deletions}</span>
            <span class="path">${escapeHtml(f.filePath)}</span>
          </div>`).join('')}</div>
          <div class="actions">
            <button onclick="vscode.postMessage({command:'accept',proposalId:'${escapeHtml(p.proposalId)}'})">✓ Keep All</button>
            <button onclick="vscode.postMessage({command:'reject',proposalId:'${escapeHtml(p.proposalId)}'})">✗ Undo All</button>
          </div>
        </div>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pending Changes</title>
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 16px; }
  h2 { margin-top: 0; }
  .proposal { border: 1px solid var(--vscode-panel-border); border-radius: 4px; margin-bottom: 12px; padding: 12px; }
  .header { margin-bottom: 8px; }
  .agent { font-weight: bold; margin-right: 8px; }
  .desc { color: var(--vscode-descriptionForeground); }
  .files { margin-bottom: 8px; font-size: 0.9em; }
  .file { margin: 2px 0; }
  .additions { color: #4caf50; margin-right: 6px; }
  .deletions { color: #f44336; margin-right: 6px; }
  .path { color: var(--vscode-textLink-foreground); }
  .actions button { margin-right: 8px; padding: 4px 12px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground);
    border: none; border-radius: 2px; }
  .actions button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
<h2>Pending AI Changes</h2>
${rows}
<script>const vscode = acquireVsCodeApi();</script>
</body>
</html>`;
  }

  dispose(): void {
    this.disposables.forEach(d => d.dispose());
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
