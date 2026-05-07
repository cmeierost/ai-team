import { z } from 'zod';
import type {
  ICommand,
  CommandRuntime,
  ICodeEditManager,
  IIdeAdapterFactory,
  IProposalStoreFactory,
} from '@ai-team/core';
import { patchApplyCommandAsync } from './patch.js';

type Params = z.infer<typeof PatchApplyCommand.schema>;
type Result = { proposalId: string; patchedLines: number };

export class PatchApplyCommand implements ICommand<Params, void, Result> {
  static readonly schema = z.object({
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

  readonly key = 'patchApply';
  readonly cli = { command: 'patch <file> <line> <content>' };
  readonly description =
    'Replace one or more lines in a file and send a code-edit proposal through the configured editor adapter';
  readonly availableIn = { cli: true };
  readonly parameters = PatchApplyCommand.schema;

  constructor(
    private readonly codeEditManager: ICodeEditManager,
    private readonly ideAdapterFactory: IIdeAdapterFactory,
    private readonly proposalStoreFactory: IProposalStoreFactory
  ) {}

  async execute(payload: Params, _ctx: void, runtime: CommandRuntime): Promise<Result> {
    return patchApplyCommandAsync(
      runtime.workspaceRoot,
      payload,
      this.codeEditManager,
      this.ideAdapterFactory,
      this.proposalStoreFactory
    );
  }
}
