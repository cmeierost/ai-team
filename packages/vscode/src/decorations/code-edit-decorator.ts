import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IdeCodeEditProposal } from '@ai-team/ide-interface';
import type { IdeLocalServer } from '../ide-local-server';

interface PendingProposal {
  proposal: IdeCodeEditProposal;
  /** tmp dir holding .orig files for each changed file */
  tmpDir: string;
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
  private pending = new Map<string, PendingProposal>();
  private disposables: vscode.Disposable[] = [];
  private server: IdeLocalServer;
  /** proposalIds currently being applied — suppress change-event clearing during this window */
  private _applying = new Set<string>();

  private lenses = new Map<string, vscode.CodeLens[]>(); // uri → lenses
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();

  /** Fires after any proposal is accepted, rejected, or auto-cleared by manual edit. */
  private _onProposalResolved = new vscode.EventEmitter<void>();
  readonly onProposalResolved = this._onProposalResolved.event;

  constructor(context: vscode.ExtensionContext, server: IdeLocalServer) {
    this.server = server;

    const codeLensProvider: vscode.CodeLensProvider = {
      onDidChangeCodeLenses: this._onDidChangeCodeLenses.event,
      provideCodeLenses: (document) =>
        this.lenses.get(document.uri.toString()) ?? [],
    };

    this.disposables.push(
      vscode.languages.registerCodeLensProvider({ pattern: '**/*' }, codeLensProvider),
    );

    // If the user manually edits a proposed file, clear its pending proposal.
    // Guard: skip when the change was caused by a disk reload (document not dirty),
    // or while we are in the middle of applyProposal (file just written by the agent).
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        // A disk reload makes the document clean. User edits make it dirty.
        if (!e.document.isDirty) return;
        const uriStr = e.document.uri.toString();
        for (const [proposalId, p] of this.pending) {
          if (this._applying.has(proposalId)) continue; // still applying, ignore
          if (p.proposal.files.some(f => vscode.Uri.file(f.filePath).toString() === uriStr)) {
            this._clearPending(proposalId);
            this._onProposalResolved.fire();
            break;
          }
        }
      }),
    );

    context.subscriptions.push(this);
  }

  /** Called by extension.ts when the server emits a codeEditProposal event. */
  async applyProposal(proposal: IdeCodeEditProposal): Promise<void> {
    // If same proposalId arrives again (duplicate), clear the old one first
    if (this.pending.has(proposal.proposalId)) {
      this._clearPending(proposal.proposalId);
    }

    // Guard against onDidChangeTextDocument clearing us during the apply window
    this._applying.add(proposal.proposalId);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ai-team-${proposal.proposalId}-`));
    const originals = new Map<string, string>();

    for (const file of proposal.files) {
      // Use oldContent from proposal for undo source.
      // Do NOT read from disk: on replay the file already has newContent on disk.
      // Do NOT write newContent to disk: already written by the service layer.
      originals.set(file.filePath, file.oldContent);

      // Write OLD content to a temp file — used as the left side of the diff editor
      const tmpFile = path.join(tmpDir, path.basename(file.filePath) + '.orig');
      fs.writeFileSync(tmpFile, file.oldContent, 'utf8');
    }

    const pending: PendingProposal = { proposal, tmpDir, originals };
    this.pending.set(proposal.proposalId, pending);

    // Open diff editor for each file and add CodeLens to the modified (right) side
    for (const file of proposal.files) {
      const tmpFile = path.join(tmpDir, path.basename(file.filePath) + '.orig');
      const origUri = vscode.Uri.file(tmpFile);
      const newUri = vscode.Uri.file(file.filePath);
      const title = `AI Team · ${path.basename(file.filePath)}  (${proposal.agentName})`;

      await vscode.commands.executeCommand('vscode.diff', origUri, newUri, title, {
        preview: true,
        preserveFocus: false,
      });

      // Add CodeLens to the actual (right-side, modified) file
      this.lenses.set(newUri.toString(), [
        new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
          title: `✓ Keep  ·  ${proposal.agentName}: ${proposal.description}`,
          command: 'ai-team.acceptChange',
          arguments: [proposal.proposalId],
        }),
        new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
          title: '✗ Undo changes',
          command: 'ai-team.rejectChange',
          arguments: [proposal.proposalId],
        }),
      ]);
    }

    this._onDidChangeCodeLenses.fire();

    // Release the apply guard after VS Code has had time to reload the file
    setTimeout(() => this._applying.delete(proposal.proposalId), 2000);
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

    // Restore the original content
    for (const [filePath, original] of p.originals) {
      try { fs.writeFileSync(filePath, original, 'utf8'); } catch { /* best-effort */ }
    }

    this._clearPending(proposalId);
    this.server.broadcastAck(proposalId, 'reject');
    this._onProposalResolved.fire();
  }

  getPendingProposals(): IdeCodeEditProposal[] {
    return Array.from(this.pending.values()).map(p => p.proposal);
  }

  getPendingEntries(): Array<{ proposal: IdeCodeEditProposal; tmpDir: string }> {
    return Array.from(this.pending.values()).map(p => ({ proposal: p.proposal, tmpDir: p.tmpDir }));
  }

  private _clearPending(proposalId: string): void {
    const p = this.pending.get(proposalId);
    if (!p) return;

    try { fs.rmdirSync(p.tmpDir, { recursive: true }); } catch { /* ok */ }

    // Remove CodeLens for all files in this proposal
    for (const file of p.proposal.files) {
      this.lenses.delete(vscode.Uri.file(file.filePath).toString());
    }

    this.pending.delete(proposalId);
    this._onDidChangeCodeLenses.fire();
  }

  dispose(): void {
    for (const p of this.pending.values()) {
      try { fs.rmdirSync(p.tmpDir, { recursive: true }); } catch { /* ok */ }
    }
    this._onProposalResolved.dispose();
    this._onDidChangeCodeLenses.dispose();
    this.disposables.forEach(d => d.dispose());
  }
}
