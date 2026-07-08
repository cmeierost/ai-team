import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import type {
  ICommand,
  ICodeEditManager,
  IIdeAdapterFactory,
  IProposalStoreFactory,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';

type Params = z.infer<typeof PatchApplyCommand.schema>;
type Result = { proposalId: string; patchedLines: number };
const _patchApplyCommandSchema = z.object({
  file: z.string().describe('File path to patch'),
  changes: z
    .array(
      z.object({
        line: z.number().describe('Line number (1-based)'),
        content: z.string().describe('New content for this line'),
      })
    )
    .describe('Line changes to apply'),
});

export const PatchApplyCommandMetadata = {
  key: 'patch',
  description:
    'Replace one or more lines in a file and send a code-edit proposal through the configured editor adapter',
  availableIn: { cli: true },
  group: 'edit',
  parameters: _patchApplyCommandSchema,
} satisfies ICommandDescriptor;

export class PatchApplyCommand implements ICommand<Params, Result> {
  static readonly schema = _patchApplyCommandSchema;
  readonly metadata = PatchApplyCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly codeEditManager: ICodeEditManager,
    private readonly ideAdapterFactory: IIdeAdapterFactory,
    private readonly proposalStoreFactory: IProposalStoreFactory
  ) {}

  async execute(payload: Params, _ctx: ExecutionContext): Promise<CommandResponse<Result>> {
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

    const lineLabel = payload.changes.map((c) => `line ${c.line}`).join(', ');
    const description = `Patch ${lineLabel} of ${path.relative(this.workspaceRoot, absPath)}`;

    const { proposal } = await this.codeEditManager.createProposal('cli:patch', {
      description,
      changes: [{ filePath: absPath, oldContent, newContent }],
    });
    this.codeEditManager.approveProposal(proposal.id);
    await this.codeEditManager.applyProposal(proposal.id);

    const proposalId = proposal.id;

    const store = this.proposalStoreFactory.create(this.workspaceRoot);
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

    const data = { proposalId, patchedLines: payload.changes.length };
    return { status: 'ok', data };
  }
}
