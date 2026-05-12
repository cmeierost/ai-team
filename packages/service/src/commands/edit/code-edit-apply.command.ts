import { z } from 'zod';
import type {
  ICommand,
  ICodeEditManager,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import { ProposalStatus } from '@ai-team/core';
import { toInteractionContext } from './code-edit-utils.js';

type ApplyParams = z.infer<typeof CodeEditApplyCommand.schema>;

export class CodeEditApplyCommand
  implements ICommand<ApplyParams, { proposalId: string; files: string[] }>
{
  static readonly schema = z.object({
    proposalId: z.string().describe('Proposal id to apply'),
  });

  readonly key = 'codeEditApply';
  readonly cli = { command: 'code-edit apply <proposalId>' };
  readonly description = 'Apply an approved code edit proposal';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = CodeEditApplyCommand.schema;

  constructor(private readonly manager: ICodeEditManager) {}

  async execute(
    payload: ApplyParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<{ proposalId: string; files: string[] }>> {
    const proposal = this.manager.getProposal(payload.proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${payload.proposalId} not found`);
    }
    if (proposal.status !== ProposalStatus.APPROVED) {
      throw new Error(
        `Proposal ${payload.proposalId} is not approved (status: ${proposal.status}). Approve it first.`
      );
    }

    const context = toInteractionContext(ctx);
    if (context.questionConfirm) {
      const confirmed = await context.questionConfirm({
        message: `Apply ${proposal.changes.length} file change(s) from proposal ${payload.proposalId.substring(0, 12)}...?`,
        default: false,
      });
      if (!confirmed) {
        throw new Error('Operation cancelled by user');
      }
    }

    await this.manager.applyProposal(payload.proposalId);
    return {
      status: 'ok',
      data: {
        proposalId: payload.proposalId,
        files: proposal.changes.map((c) => c.filePath),
      },
    };
  }
}
