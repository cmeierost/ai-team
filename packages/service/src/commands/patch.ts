import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ProposalStore } from '../storage/proposal-store.js';
import {
  InfrastructureIdeAdapterFactory,
  type IIdeAdapterFactory,
} from '../runtime/infrastructure-adapters.js';

export class PatchCommand {
  constructor(
    private readonly workspaceRoot: string,
    private readonly ideAdapterFactory: IIdeAdapterFactory = new InfrastructureIdeAdapterFactory()
  ) {}

  async applyAsync(payload: {
    file: string;
    changes: Array<{ line: number; content: string }>;
  }): Promise<{ proposalId: string; patchedLines: number }> {
    const absPath = path.isAbsolute(payload.file)
      ? payload.file
      : path.join(this.workspaceRoot, payload.file);

    if (!fs.existsSync(absPath)) {
      throw new Error(`File not found: ${absPath}`);
    }

    const oldContent = fs.readFileSync(absPath, 'utf-8');
    const lines = oldContent.split('\n');

    for (const change of payload.changes) {
      if (change.line < 1 || change.line > lines.length) {
        throw new Error(`Line ${change.line} out of range (file has ${lines.length} lines)`);
      }
    }

    for (const change of payload.changes) {
      lines[change.line - 1] = change.content;
    }
    const newContent = lines.join('\n');

    if (oldContent === newContent) {
      throw new Error('No change — new content is identical to existing lines.');
    }

    fs.writeFileSync(absPath, newContent, 'utf-8');

    const lineLabel = payload.changes.map((c) => `line ${c.line}`).join(', ');
    const description = `Patch ${lineLabel} of ${path.relative(this.workspaceRoot, absPath)}`;
    const proposalId = `patch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    const store = new ProposalStore(this.workspaceRoot);
    for (const existing of store.loadAll()) {
      if (existing.files.some((f) => f.filePath === absPath)) {
        store.delete(existing.proposalId);
      }
    }
    store.save({
      proposalId,
      agentName: 'cli:patch',
      description,
      createdAt: new Date().toISOString(),
      files: [{ filePath: absPath, oldContent, newContent }],
    });

    try {
      const adapter = await this.ideAdapterFactory.createAsync(this.workspaceRoot, 'cli');
      if (adapter.isConnected()) {
        await adapter.notifyCodeEditProposal({
          proposalId,
          agentName: 'cli:patch',
          description,
          files: [
            {
              filePath: absPath,
              oldContent,
              newContent,
              additions: payload.changes.length,
              deletions: payload.changes.length,
            },
          ],
        });
      }
      adapter.dispose();
    } catch {
      // not fatal
    }

    return { proposalId, patchedLines: payload.changes.length };
  }
}

export async function patchApplyCommandAsync(
  workspaceRoot: string,
  payload: { file: string; changes: Array<{ line: number; content: string }> }
): Promise<{ proposalId: string; patchedLines: number }> {
  const cmd = new PatchCommand(workspaceRoot);
  return cmd.applyAsync(payload);
}
