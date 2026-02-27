/**
 * Code Edit Panel - Webview for reviewing and approving code edit proposals
 */

import * as vscode from 'vscode';
import { CodeEditManager, type CodeEditProposal, ProposalStatus } from '@ai-team/core';

export class CodeEditPanel {
  public static currentPanel: CodeEditPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    codeEditManager: CodeEditManager,
    proposalId?: string
  ) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (CodeEditPanel.currentPanel) {
      CodeEditPanel.currentPanel._panel.reveal(column);
      if (proposalId) {
        CodeEditPanel.currentPanel._showProposal(proposalId);
      } else {
        CodeEditPanel.currentPanel._update();
      }
      return;
    }

    // Otherwise, create a new panel
    const panel = vscode.window.createWebviewPanel(
      'aiTeamCodeEdit',
      'Code Edit Review',
      column || vscode.ViewColumn.Two,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    CodeEditPanel.currentPanel = new CodeEditPanel(panel, extensionUri, codeEditManager);

    if (proposalId) {
      CodeEditPanel.currentPanel._showProposal(proposalId);
    }
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private codeEditManager: CodeEditManager
  ) {
    this._panel = panel;

    // Set the webview's initial html content
    this._update();

    // Listen for when the panel is disposed
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case 'approve':
            await this._handleApprove(message.proposalId);
            break;
          case 'reject':
            await this._handleReject(message.proposalId, message.reason);
            break;
          case 'apply':
            await this._handleApply(message.proposalId);
            break;
          case 'viewDiff':
            await this._handleViewDiff(message.proposalId, message.filePath);
            break;
          case 'showProposal':
            this._showProposal(message.proposalId);
            break;
          case 'refresh':
            this._update();
            break;
        }
      },
      null,
      this._disposables
    );
  }

  private async _handleApprove(proposalId: string) {
    try {
      this.codeEditManager.approveProposal(proposalId);
      vscode.window.showInformationMessage(
        `Proposal ${proposalId} approved. Click "Apply" to write changes.`
      );
      this._update();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to approve: ${error}`);
    }
  }

  private async _handleReject(proposalId: string, reason: string) {
    try {
      this.codeEditManager.rejectProposal(proposalId, reason);
      vscode.window.showInformationMessage(`Proposal ${proposalId} rejected`);
      this._update();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to reject: ${error}`);
    }
  }

  private async _handleApply(proposalId: string) {
    try {
      await this.codeEditManager.applyProposal(proposalId);
      vscode.window.showInformationMessage(
        `Proposal ${proposalId} applied successfully!`
      );
      this._update();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to apply: ${error}`);
    }
  }

  private async _handleViewDiff(proposalId: string, filePath: string) {
    const proposal = this.codeEditManager.getProposal(proposalId);
    if (!proposal) return;

    const change = proposal.changes.find((c) => c.filePath === filePath);
    if (!change) return;

    // Create virtual documents for diff view
    const originalUri = vscode.Uri.parse(
      `ai-team-diff:${filePath}?original&proposal=${proposalId}`
    );
    const modifiedUri = vscode.Uri.parse(
      `ai-team-diff:${filePath}?modified&proposal=${proposalId}`
    );

    // Register content provider if not already registered
    this._registerDiffContentProvider(proposal);

    // Open diff editor
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      modifiedUri,
      `${filePath} (Proposal ${proposalId.substring(0, 8)})`
    );
  }

  private _registerDiffContentProvider(proposal: CodeEditProposal) {
    const provider = new DiffContentProvider(proposal);
    this._disposables.push(
      vscode.workspace.registerTextDocumentContentProvider('ai-team-diff', provider)
    );
  }

  private _showProposal(proposalId: string) {
    const proposal = this.codeEditManager.getProposal(proposalId);
    if (!proposal) {
      vscode.window.showErrorMessage(`Proposal ${proposalId} not found`);
      return;
    }

    this._panel.webview.html = this._getProposalDetailHtml(proposal);
  }

  private _update() {
    const proposals = this.codeEditManager.getAllProposals();
    this._panel.webview.html = this._getProposalListHtml(proposals);
  }

  private _getProposalListHtml(proposals: CodeEditProposal[]): string {
    const pendingProposals = proposals.filter(
      (p) => p.status === ProposalStatus.PENDING
    );
    const approvedProposals = proposals.filter(
      (p) => p.status === ProposalStatus.APPROVED
    );
    const otherProposals = proposals.filter(
      (p) => p.status !== ProposalStatus.PENDING && p.status !== ProposalStatus.APPROVED
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Edit Proposals</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    h1, h2 {
      color: var(--vscode-foreground);
    }
    .proposal-card {
      background-color: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 16px;
      margin-bottom: 12px;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .proposal-card:hover {
      background-color: var(--vscode-list-hoverBackground);
    }
    .proposal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .proposal-id {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    .proposal-status {
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 0.85em;
      font-weight: 600;
    }
    .status-pending {
      background-color: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
    }
    .status-approved {
      background-color: var(--vscode-inputValidation-infoBackground);
      color: var(--vscode-inputValidation-infoForeground);
    }
    .status-rejected {
      background-color: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }
    .status-applied {
      background-color: #2ea043;
      color: white;
    }
    .proposal-description {
      margin: 8px 0;
      font-weight: 500;
    }
    .proposal-metadata {
      font-size: 0.85em;
      color: var(--vscode-descriptionForeground);
    }
    .proposal-stats {
      display: flex;
      gap: 16px;
      margin-top: 8px;
      font-size: 0.9em;
    }
    .stat {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .stat-add {
      color: #2ea043;
    }
    .stat-del {
      color: #cf222e;
    }
    .empty-state {
      text-align: center;
      padding: 40px;
      color: var(--vscode-descriptionForeground);
    }
    .section {
      margin-bottom: 32px;
    }
    button {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: 0.9em;
      margin-top: 16px;
    }
    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
  </style>
</head>
<body>
  <h1>Code Edit Proposals</h1>
  <button onclick="refresh()">🔄 Refresh</button>

  ${
    pendingProposals.length > 0
      ? `
  <div class="section">
    <h2>⏳ Pending Review (${pendingProposals.length})</h2>
    ${pendingProposals.map((p) => this._renderProposalCard(p)).join('')}
  </div>`
      : ''
  }

  ${
    approvedProposals.length > 0
      ? `
  <div class="section">
    <h2>✅ Approved (${approvedProposals.length})</h2>
    ${approvedProposals.map((p) => this._renderProposalCard(p)).join('')}
  </div>`
      : ''
  }

  ${
    otherProposals.length > 0
      ? `
  <div class="section">
    <h2>📦 Other (${otherProposals.length})</h2>
    ${otherProposals.map((p) => this._renderProposalCard(p)).join('')}
  </div>`
      : ''
  }

  ${
    proposals.length === 0
      ? `
  <div class="empty-state">
    <h3>No proposals yet</h3>
    <p>Code edit proposals from agents will appear here.</p>
  </div>`
      : ''
  }

  <script>
    const vscode = acquireVsCodeApi();

    function showProposal(proposalId) {
      vscode.postMessage({
        command: 'showProposal',
        proposalId: proposalId
      });
    }

    function refresh() {
      vscode.postMessage({ command: 'refresh' });
    }
  </script>
</body>
</html>`;
  }

  private _renderProposalCard(proposal: CodeEditProposal): string {
    const totalAdditions = proposal.changes.reduce(
      (sum, c) => sum + c.diff.additions,
      0
    );
    const totalDeletions = proposal.changes.reduce(
      (sum, c) => sum + c.diff.deletions,
      0
    );

    const statusClass = `status-${proposal.status.toLowerCase()}`;
    const timestamp = new Date(proposal.timestamp).toLocaleString();

    return `
    <div class="proposal-card" onclick="showProposal('${proposal.id}')">
      <div class="proposal-header">
        <span class="proposal-id">${proposal.id}</span>
        <span class="proposal-status ${statusClass}">${proposal.status}</span>
      </div>
      <div class="proposal-description">${this._escapeHtml(proposal.description)}</div>
      <div class="proposal-metadata">
        By <strong>${proposal.agentName}</strong> • ${timestamp}
      </div>
      <div class="proposal-stats">
        <span class="stat">📁 ${proposal.changes.length} file${
          proposal.changes.length !== 1 ? 's' : ''
        }</span>
        <span class="stat stat-add">+${totalAdditions}</span>
        <span class="stat stat-del">-${totalDeletions}</span>
      </div>
    </div>`;
  }

  private _getProposalDetailHtml(proposal: CodeEditProposal): string {
    const totalAdditions = proposal.changes.reduce(
      (sum, c) => sum + c.diff.additions,
      0
    );
    const totalDeletions = proposal.changes.reduce(
      (sum, c) => sum + c.diff.deletions,
      0
    );
    const statusClass = `status-${proposal.status.toLowerCase()}`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proposal ${proposal.id}</title>
  <style>
    body {
      margin: 0;
      padding: 20px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    .header {
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .proposal-id {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.9em;
      color: var(--vscode-descriptionForeground);
    }
    .proposal-status {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 3px;
      font-size: 0.85em;
      font-weight: 600;
      margin-left: 12px;
    }
    .status-pending {
      background-color: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
    }
    .status-approved {
      background-color: var(--vscode-inputValidation-infoBackground);
      color: var(--vscode-inputValidation-infoForeground);
    }
    .status-rejected {
      background-color: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }
    .status-applied {
      background-color: #2ea043;
      color: white;
    }
    .description {
      font-size: 1.2em;
      margin: 16px 0;
    }
    .metadata {
      color: var(--vscode-descriptionForeground);
      font-size: 0.9em;
      margin-bottom: 8px;
    }
    .stats {
      display: flex;
      gap: 20px;
      margin: 16px 0;
      font-size: 1.1em;
    }
    .stat-add {
      color: #2ea043;
      font-weight: 600;
    }
    .stat-del {
      color: #cf222e;
      font-weight: 600;
    }
    .actions {
      display: flex;
      gap: 12px;
      margin: 20px 0;
    }
    button {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      font-size: 1em;
      font-weight: 500;
    }
    button:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-approve {
      background-color: #2ea043;
      color: white;
    }
    .btn-reject {
      background-color: #cf222e;
      color: white;
    }
    .btn-apply {
      background-color: #0969da;
      color: white;
    }
    .file-list {
      margin-top: 24px;
    }
    .file-item {
      background-color: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      padding: 12px;
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .file-path {
      font-family: var(--vscode-editor-font-family);
      font-size: 0.95em;
    }
    .file-stats {
      display: flex;
      gap: 12px;
      font-size: 0.9em;
    }
    .view-diff-btn {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      padding: 6px 12px;
      font-size: 0.9em;
    }
    .back-link {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
      cursor: pointer;
      display: inline-block;
      margin-bottom: 16px;
    }
    .back-link:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <a class="back-link" onclick="goBack()">← Back to all proposals</a>

  <div class="header">
    <div>
      <span class="proposal-id">${proposal.id}</span>
      <span class="proposal-status ${statusClass}">${proposal.status}</span>
    </div>
    <div class="description">${this._escapeHtml(proposal.description)}</div>
    <div class="metadata">
      Proposed by <strong>${proposal.agentName}</strong> on ${new Date(
        proposal.timestamp
      ).toLocaleString()}
    </div>
    <div class="stats">
      <span>📁 ${proposal.changes.length} file${
        proposal.changes.length !== 1 ? 's' : ''
      }</span>
      <span class="stat-add">+${totalAdditions}</span>
      <span class="stat-del">-${totalDeletions}</span>
    </div>
  </div>

  <div class="actions">
    <button 
      class="btn-approve" 
      onclick="approve()" 
      ${proposal.status !== ProposalStatus.PENDING ? 'disabled' : ''}
    >
      ✅ Approve
    </button>
    <button 
      class="btn-reject" 
      onclick="reject()" 
      ${proposal.status !== ProposalStatus.PENDING ? 'disabled' : ''}
    >
      ❌ Reject
    </button>
    <button 
      class="btn-apply" 
      onclick="apply()" 
      ${proposal.status !== ProposalStatus.APPROVED ? 'disabled' : ''}
    >
      🚀 Apply Changes
    </button>
  </div>

  <div class="file-list">
    <h3>Changed Files</h3>
    ${proposal.changes
      .map(
        (change) => `
      <div class="file-item">
        <div>
          <div class="file-path">${this._escapeHtml(change.filePath)}</div>
          <div class="file-stats">
            <span class="stat-add">+${change.diff.additions}</span>
            <span class="stat-del">-${change.diff.deletions}</span>
          </div>
        </div>
        <button class="view-diff-btn" onclick="viewDiff('${change.filePath}')">
          👁️ View Diff
        </button>
      </div>
    `
      )
      .join('')}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const proposalId = '${proposal.id}';

    function approve() {
      vscode.postMessage({
        command: 'approve',
        proposalId: proposalId
      });
    }

    function reject() {
      const reason = prompt('Reason for rejection (optional):') || 'Rejected by user';
      vscode.postMessage({
        command: 'reject',
        proposalId: proposalId,
        reason: reason
      });
    }

    function apply() {
      if (confirm('Apply these changes to the workspace files?')) {
        vscode.postMessage({
          command: 'apply',
          proposalId: proposalId
        });
      }
    }

    function viewDiff(filePath) {
      vscode.postMessage({
        command: 'viewDiff',
        proposalId: proposalId,
        filePath: filePath
      });
    }

    function goBack() {
      vscode.postMessage({ command: 'refresh' });
    }
  </script>
</body>
</html>`;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  public dispose() {
    CodeEditPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}

/**
 * Content provider for diff views
 */
class DiffContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private proposal: CodeEditProposal) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    const query = new URLSearchParams(uri.query);
    const isModified = query.has('modified');
    const filePath = uri.path;

    const change = this.proposal.changes.find((c) => c.filePath === filePath);
    if (!change) {
      return '';
    }

    return isModified ? change.newContent : change.oldContent;
  }
}
