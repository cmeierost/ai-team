import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ProposalStore, findWorkspaceRoot } from '@ai-team/service';
import { createIdeAdapter } from '@ai-team/infrastructure';

interface LineChange {
  lineNumber: number;
  newLineContent: string;
}

/**
 * Patch one or more lines in a file, then persist a proposal and notify VS Code.
 * Usage: ait patch <file> <line> <content> [<line2> <content2> ...]
 *
 * Line numbers are 1-based. Useful for quick testing of the proposal/diff pipeline.
 */
export async function patchCommand(
  filePath: string,
  lineStr: string,
  newLineContent: string,
  rest: string[] = [],
): Promise<void> {
  // Parse the repeating line/content pairs from rest args
  const changes: LineChange[] = [];
  const allPairs: Array<[string, string]> = [[lineStr, newLineContent]];
  for (let i = 0; i + 1 < rest.length; i += 2) {
    allPairs.push([rest[i], rest[i + 1]]);
  }
  for (const [ls, content] of allPairs) {
    const n = parseInt(ls, 10);
    if (isNaN(n) || n < 1) {
      console.error(`Error: line must be a positive integer, got: ${ls}`);
      process.exitCode = 1;
      return;
    }
    changes.push({ lineNumber: n, newLineContent: content });
  }

  const workspaceRoot = findWorkspaceRoot();
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.join(workspaceRoot, filePath);

  if (!fs.existsSync(absPath)) {
    console.error(`Error: file not found: ${absPath}`);
    process.exitCode = 1;
    return;
  }

  const oldContent = fs.readFileSync(absPath, 'utf-8');
  const lines = oldContent.split('\n');

  for (const { lineNumber } of changes) {
    if (lineNumber > lines.length) {
      console.error(`Error: file has ${lines.length} lines, cannot patch line ${lineNumber}`);
      process.exitCode = 1;
      return;
    }
  }

  for (const { lineNumber, newLineContent: nc } of changes) {
    const oldLine = lines[lineNumber - 1];
    lines[lineNumber - 1] = nc;
    console.error(`Patched line ${lineNumber}: ${JSON.stringify(oldLine)} → ${JSON.stringify(nc)}`);
  }
  const newContent = lines.join('\n');

  if (oldContent === newContent) {
    console.error('No change — new content is identical to the existing lines.');
    return;
  }

  // Write to disk
  fs.writeFileSync(absPath, newContent, 'utf-8');

  // Persist to ProposalStore — replace any existing proposals for the same file
  const lineLabel = changes.map(c => `line ${c.lineNumber}`).join(', ');
  const description = `Patch ${lineLabel} of ${path.relative(workspaceRoot, absPath)}`;
  const proposalId = `patch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const store = new ProposalStore(workspaceRoot);
  for (const existing of store.loadAll()) {
    if (existing.files.some(f => f.filePath === absPath)) {
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
  console.error(`Proposal saved: ${proposalId}`);

  // Notify VS Code plugin (best-effort)
  try {
    const adapter = await createIdeAdapter(workspaceRoot, 'cli');
    if (adapter.isConnected()) {
      await adapter.notifyCodeEditProposal({
        proposalId,
        agentName: 'cli:patch',
        description,
        files: [{
          filePath: absPath,
          oldContent,
          newContent,
          additions: changes.length,
          deletions: changes.length,
        }],
      });
      console.error('VS Code notified.');
    } else {
      console.error('VS Code plugin not connected — proposal stored for replay on next connect.');
    }
    adapter.dispose();
  } catch {
    // not fatal
  }
}
