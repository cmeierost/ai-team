import * as vscode from 'vscode';
import * as path from 'path';
import type { IdeCodeEditProposal, IdeCodeEditFile } from '@ai-team/ide-interface';

// ─── Tree node types ───────────────────────────────────────────────────────

export class ProposalItem extends vscode.TreeItem {
  constructor(public readonly proposal: IdeCodeEditProposal) {
    const totalAdded = proposal.files.reduce((s, f) => s + (f.additions ?? 0), 0);
    const totalDel = proposal.files.reduce((s, f) => s + (f.deletions ?? 0), 0);
    const label = `${proposal.agentName}: ${proposal.description}`;
    super(label, vscode.TreeItemCollapsibleState.Expanded);

    const fileWord = proposal.files.length === 1 ? 'file' : 'files';
    this.description = `${proposal.files.length} ${fileWord}  +${totalAdded} -${totalDel}`;
    this.tooltip = proposal.description;
    this.contextValue = 'proposal';
    this.iconPath = new vscode.ThemeIcon('git-pull-request');
  }
}

export class PendingFileItem extends vscode.TreeItem {
  constructor(
    public readonly file: IdeCodeEditFile,
    public readonly proposalId: string,
    public readonly proposalTmpDir: string,
  ) {
    super(path.basename(file.filePath), vscode.TreeItemCollapsibleState.None);

    const rel = vscode.workspace.workspaceFolders?.[0]
      ? path.relative(vscode.workspace.workspaceFolders[0].uri.fsPath, path.dirname(file.filePath))
      : path.dirname(file.filePath);

    this.description = `${rel}   +${file.additions ?? 0} -${file.deletions ?? 0}`;
    this.tooltip = file.filePath;
    this.contextValue = 'pendingFile';
    this.iconPath = new vscode.ThemeIcon('file');
    this.resourceUri = vscode.Uri.file(file.filePath);

    // Clicking the row opens the diff — pass primitives only (no circular refs)
    this.command = {
      command: 'ai-team.showFileDiff',
      title: 'Show Diff',
      arguments: [file.filePath, proposalId, proposalTmpDir],
    };
  }
}

type TreeNode = ProposalItem | PendingFileItem;

// ─── Provider ──────────────────────────────────────────────────────────────

export class PendingChangesProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  /** proposal id → { proposal, tmpDir } so we can open diffs */
  private proposals: Map<string, { proposal: IdeCodeEditProposal; tmpDir: string }> = new Map();

  setProposals(entries: Array<{ proposal: IdeCodeEditProposal; tmpDir: string }>): void {
    this.proposals = new Map(entries.map(e => [e.proposal.proposalId, e]));
    this._onDidChangeTreeData.fire();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      // Root: one ProposalItem per pending proposal
      return Array.from(this.proposals.values()).map(e => new ProposalItem(e.proposal));
    }
    if (element instanceof ProposalItem) {
      const entry = this.proposals.get(element.proposal.proposalId);
      if (!entry) return [];
      return entry.proposal.files.map(
        f => new PendingFileItem(f, entry.proposal.proposalId, entry.tmpDir),
      );
    }
    return [];
  }

  getTmpDir(proposalId: string): string | undefined {
    return this.proposals.get(proposalId)?.tmpDir;
  }
}
