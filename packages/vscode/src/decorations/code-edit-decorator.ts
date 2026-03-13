import * as vscode from 'vscode';
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

  private readonly lenses = new Map<string, vscode.CodeLens[]>(); // uri → lenses
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();

  /** Fires after any proposal is accepted, rejected, or auto-cleared by manual edit. */
  private readonly _onProposalResolved = new vscode.EventEmitter<void>();
  readonly onProposalResolved = this._onProposalResolved.event;

  constructor(context: vscode.ExtensionContext, server: IdeLocalServer) {
    this.server = server;

    const codeLensProvider: vscode.CodeLensProvider = {
      onDidChangeCodeLenses: this._onDidChangeCodeLenses.event,
      provideCodeLenses: (document) =>
        this.lenses.get(document.uri.toString()) ?? [],
    };

    const codeLensDisposable = vscode.languages.registerCodeLensProvider({ pattern: '**/*' }, codeLensProvider);

    // If the user manually edits a proposed file, clear its pending proposal.
    // Guard: skip when the change was caused by a disk reload (document not dirty),
    // or while we are in the middle of applyProposal (file just written by the agent).
    const textChangeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
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
      });

    this.disposables.push(codeLensDisposable, textChangeDisposable);

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

    const originals = new Map<string, string>();

    for (const file of proposal.files) {
      // Use oldContent from proposal for undo source.
      // Do NOT read from disk: on replay the file already has newContent on disk.
      originals.set(file.filePath, file.oldContent);

      await this.replaceFileContent(file.filePath, file.newContent);
    }

    const pending: PendingProposal = { proposal, originals };
    this.pending.set(proposal.proposalId, pending);

    // Open diff editor for each file and add CodeLens to the modified (right) side
    for (const file of proposal.files) {
      await this.openDiffForFile(proposal.proposalId, file.filePath);

      const newUri = vscode.Uri.file(file.filePath);

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

  async openDiffForFile(proposalId: string, filePath: string): Promise<void> {
    const pending = this.pending.get(proposalId);
    if (!pending) return;

    const originalContent = pending.originals.get(filePath);
    if (originalContent === undefined) return;

    const newUri = vscode.Uri.file(filePath);
    const leftUri = this.createVirtualOriginalUri(filePath, originalContent);
    const title = `AI Team · ${path.basename(filePath)}  (${pending.proposal.agentName})`;

    await vscode.commands.executeCommand('vscode.diff', leftUri, newUri, title, {
      preview: true,
      preserveFocus: false,
    });
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

    void (async () => {
      // Restore the original content using VS Code editor APIs
      for (const [filePath, original] of p.originals) {
        try {
          await this.replaceFileContent(filePath, original);
        } catch {
          // best-effort
        }
      }

      this._clearPending(proposalId);
      this.server.broadcastAck(proposalId, 'reject');
      this._onProposalResolved.fire();
    })();
  }

  getPendingProposals(): IdeCodeEditProposal[] {
    return Array.from(this.pending.values()).map(p => p.proposal);
  }

  private _clearPending(proposalId: string): void {
    const p = this.pending.get(proposalId);
    if (!p) return;

    // Remove CodeLens for all files in this proposal
    for (const file of p.proposal.files) {
      this.lenses.delete(vscode.Uri.file(file.filePath).toString());
    }

    this.pending.delete(proposalId);
    this._onDidChangeCodeLenses.fire();
  }

  dispose(): void {
    this._onProposalResolved.dispose();
    this._onDidChangeCodeLenses.dispose();
    this.disposables.forEach(d => d.dispose());
  }

  private createVirtualOriginalUri(filePath: string, originalContent: string): vscode.Uri {
    const fileName = path.basename(filePath);
    return vscode.Uri.parse(`${CodeEditDecorationManager.DIFF_URI_SCHEME}:${fileName}`).with({
      query: Buffer.from(originalContent).toString('base64'),
    });
  }

  private async replaceFileContent(filePath: string, content: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(uri);
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(document.getText().length),
    );

    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullRange, content);
    await vscode.workspace.applyEdit(edit);
    await document.save();
  }
}
