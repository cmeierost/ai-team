import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { ProposalStore, findWorkspaceRoot } from '@ai-team/service';
import { createIdeAdapter } from '@ai-team/ide-interface';

/**
 * Patch a single line in a file, then persist a proposal and notify VS Code.
 * Usage: ait patch <file> <line> <newContent>
 *
 * Line numbers are 1-based. Useful for quick testing of the proposal/diff pipeline.
 */
export async function patchCommand(
  filePath: string,
  lineStr: string,
  newLineContent: string,
): Promise<void> {
  const lineNumber = parseInt(lineStr, 10);
  if (isNaN(lineNumber) || lineNumber < 1) {
    console.error(`Error: line must be a positive integer, got: ${lineStr}`);
    process.exitCode = 1;
    return;
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

  if (lineNumber > lines.length) {
    console.error(`Error: file has ${lines.length} lines, cannot patch line ${lineNumber}`);
    process.exitCode = 1;
    return;
  }

  const oldLine = lines[lineNumber - 1];
  lines[lineNumber - 1] = newLineContent;
  const newContent = lines.join('\n');

  if (oldContent === newContent) {
    console.error('No change — new content is identical to the existing line.');
    return;
  }

  // Write to disk
  fs.writeFileSync(absPath, newContent, 'utf-8');
  console.error(`Patched line ${lineNumber}: ${JSON.stringify(oldLine)} → ${JSON.stringify(newLineContent)}`);

  // Persist to ProposalStore
  const proposalId = `patch_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const store = new ProposalStore(workspaceRoot);
  store.save({
    proposalId,
    agentName: 'cli:patch',
    description: `Patch line ${lineNumber} of ${path.relative(workspaceRoot, absPath)}`,
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
        description: `Patch line ${lineNumber} of ${path.relative(workspaceRoot, absPath)}`,
        files: [{
          filePath: absPath,
          oldContent,
          newContent,
          additions: 1,
          deletions: 1,
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
