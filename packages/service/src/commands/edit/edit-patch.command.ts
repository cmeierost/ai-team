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
import { patchApplyCommandAsync } from './patch.js';

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
  key: 'patchApply',
  cli: { command: 'patch <file> <line> <content>' },
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
    private readonly codeEditManager: ICodeEditManager,
    private readonly ideAdapterFactory: IIdeAdapterFactory,
    private readonly proposalStoreFactory: IProposalStoreFactory
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<Result>> {
    const data = await patchApplyCommandAsync(
      ctx.workspaceRoot,
      payload,
      this.codeEditManager,
      this.ideAdapterFactory,
      this.proposalStoreFactory
    );
    return { status: 'ok', data };
  }
}
