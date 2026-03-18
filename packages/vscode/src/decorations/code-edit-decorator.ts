import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { IdeCodeEditProposal } from '@ai-team/ide-interface';
import type { IdeLocalServer } from '../ide-local-server';

interface PendingProposal {
  proposal: IdeCodeEditProposal;
  /** original content keyed by absolute filePath, for undo */
  originals: Map<string, string>;
}

/**
 * Manages keep/undo (Copilot-style) diffs for AI code-edit proposals.
 *
 * Strategy:
 *  1. Write newContent to the actual file on disk.
 *  2. Write oldContent to a temp file.
 *  3. Open VS Code's built-in diff editor: vscode.diff(tmpOrig, actualFile).
 *  4. Register a CodeLensProvider on the actual file so "✓ Keep / ✗ Undo" appear.
 *  5. On Keep: delete tmp files, broadcast ack.
 *     On Undo: restore original content, delete tmp files, broadcast ack.
 */
export class CodeEditDecorationManager implements vscode.Disposable {
  static readonly DIFF_URI_SCHEME = 'ai-team-diff';

  private readonly pending = new Map<string, PendingProposal>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly server: IdeLocalServer;
  /** proposalIds currently being applied — suppress change-event clearing during this window */
  private readonly _applying = new Set<string>();

  /** Fires after any proposal is accepted, rejected, or auto-cleared by manual edit. */
  private readonly _onProposalResolved = new vscode.EventEmitter<void>();
  readonly onProposalResolved = this._onProposalResolved.event;

  /**
   * Stores original file content keyed by `/<proposalId>/<basename>` for the virtual
   * diff left-side document provider in extension.ts.
   */
  private readonly originalContentMap = new Map<string, string>();

  constructor(context: vscode.ExtensionContext, server: IdeLocalServer) {
    this.server = server;

    // If the user manually edits a proposed file, clear its pending proposal.
    // Guard: skip when the change was caused by a disk reload (document not dirty),
    // or while we are in the middle of applyProposal (file just written by the agent).
    const textChangeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
        if (!e.document.isDirty) return;
        const uriStr = e.document.uri.toString();
        for (const [proposalId, p] of this.pending) {
          if (this._applying.has(proposalId)) continue;
          if (p.proposal.files.some(f => vscode.Uri.file(f.filePath).toString() === uriStr)) {
            this._clearPending(proposalId);
            this._onProposalResolved.fire();
            break;
          }
        }
      });

    this.disposables.push(textChangeDisposable);

    context.subscriptions.push(this);
  }

  /** Called by extension.ts when the server emits a codeEditProposal event. */
  async applyProposal(proposal: IdeCodeEditProposal): Promise<void> {
    // If same proposalId arrives again (duplicate), clear the old one first
    if (this.pending.has(proposal.proposalId)) {
      this._clearPending(proposal.proposalId);
    }

    // Supersede any existing pending proposals that touch the same files.
    // Carry forward the oldest known original so undo always reverts to the
    // pre-agent state, not just to the previous patch's intermediate content.
    const newFilePaths = new Set(proposal.files.map(f => f.filePath));
    const inheritedOriginals = new Map<string, string>();
    for (const [existingId, p] of this.pending) {
      if (p.proposal.files.some(f => newFilePaths.has(f.filePath))) {
        for (const [fp, orig] of p.originals) {
          if (newFilePaths.has(fp)) {
            inheritedOriginals.set(fp, orig);
          }
        }
        this._clearPending(existingId);
        this._onProposalResolved.fire();
      }
    }

    // Guard against onDidChangeTextDocument clearing us during the apply window
    this._applying.add(proposal.proposalId);

    const originals = new Map<string, string>();

    for (const file of proposal.files) {
      // Prefer inherited original (true pre-agent state) over the proposal's oldContent,
      // which may already reflect an intermediate patch.
      // Do NOT read from disk: on replay the file already has newContent on disk.
      originals.set(file.filePath, inheritedOriginals.get(file.filePath) ?? file.oldContent);
      this.replaceFileContent(file.filePath, file.newContent);
    }

    const pending: PendingProposal = { proposal, originals };
    this.pending.set(proposal.proposalId, pending);

    // Give VS Code time to detect the file change on disk before opening the diff,
    // otherwise the right side still shows the old content.
    await new Promise(r => setTimeout(r, 300));

    // Open diff for each modified file
    for (const file of proposal.files) {
      await this.openDiffForFile(proposal.proposalId, file.filePath);
    }

    // Release the apply guard after VS Code has had time to reload the file
    setTimeout(() => this._applying.delete(proposal.proposalId), 2000);
  }

  async openDiffForFile(proposalId: string, filePath: string): Promise<void> {
    const pending = this.pending.get(proposalId);
    if (!pending) return;

    const originalContent = pending.originals.get(filePath);
    if (originalContent === undefined) return;

    // Register the original content under a stable key so the content provider can serve it.
    // Using a path-based key avoids URL-encoding issues that arise with base64 in URI query strings.
    const key = `/${proposalId}/${path.basename(filePath)}`;
    this.originalContentMap.set(key, originalContent);

    const leftUri = vscode.Uri.from({
      scheme: CodeEditDecorationManager.DIFF_URI_SCHEME,
      path: key,
    });
    const newUri = vscode.Uri.file(filePath);
    const title = `AI Team · ${path.basename(filePath)}  (${pending.proposal.agentName})`;

    await vscode.commands.executeCommand('vscode.diff', leftUri, newUri, title, {
      preview: true,
      preserveFocus: false,
    });
  }

  /** Returns the original content for a given virtual URI path (used by the content provider). */
  getOriginalContent(key: string): string | undefined {
    return this.originalContentMap.get(key);
  }

  acceptProposal(proposalId: string): void {
    // New content is already on disk — just clean up temp files and ack
    this._clearPending(proposalId);
    this.server.broadcastAck(proposalId, 'accept');
    this._onProposalResolved.fire();
  }

  rejectProposal(proposalId: string): void {
    const p = this.pending.get(proposalId);
    if (!p) return;

    for (const [filePath, original] of p.originals) {
      try {
        this.replaceFileContent(filePath, original);
      } catch {
        // best-effort
      }
    }

    this._clearPending(proposalId);
    this.server.broadcastAck(proposalId, 'reject');
    this._onProposalResolved.fire();
  }

  getPendingProposals(): IdeCodeEditProposal[] {
    return Array.from(this.pending.values()).map(p => p.proposal);
  }

  private _clearPending(proposalId: string): void {
    const p = this.pending.get(proposalId);
    if (!p) return;

    // Remove virtual document content from the map
    for (const file of p.proposal.files) {
      this.originalContentMap.delete(`/${proposalId}/${path.basename(file.filePath)}`);
    }

    this.pending.delete(proposalId);
  }

  dispose(): void {
    this._onProposalResolved.dispose();
    this.disposables.forEach(d => d.dispose());
  }



  private replaceFileContent(filePath: string, content: string): void {
    // Write directly via fs to avoid VS Code opening the file in an editor tab.
    fs.writeFileSync(filePath, content, 'utf-8');
  }
}

