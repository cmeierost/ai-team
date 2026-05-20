import { z } from 'zod';
import type { ICommand, ICodeEditManager, ExecutionContext, CommandResponse } from '@ai-team/core';
import { ProposalStatus } from '@ai-team/core';
import type { IQuestionService } from '../../questions/question-service.js';

type ApplyParams = z.infer<typeof CodeEditApplyCommand.schema>;

export class CodeEditApplyCommand implements ICommand<
  ApplyParams,
  { proposalId: string; files: string[] }
> {
  static readonly schema = z.object({
    proposalId: z.string().describe('Proposal id to apply'),
  });

  readonly key = 'codeEditApply';
  readonly cli = { command: 'code-edit apply <proposalId>' };
  readonly description = 'Apply an approved code edit proposal';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = CodeEditApplyCommand.schema;

  constructor(
    private readonly manager: ICodeEditManager,
    private readonly questionService: IQuestionService
  ) {}

  async execute(
    payload: ApplyParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<{ proposalId: string; files: string[] }>> {
    const proposal = this.manager.getProposal(payload.proposalId);
    if (!proposal) {
      return {
        status: 'error',
        message: `Proposal ${payload.proposalId} not found`,
      };
    }
    if (proposal.status !== ProposalStatus.APPROVED) {
      return {
        status: 'error',
        message: `Proposal ${payload.proposalId} is not approved (status: ${proposal.status}). Approve it first.`,
      };
    }

    const confirmed = await this.questionService.confirm(
      {
        message: `Apply ${proposal.changes.length} file change(s) from proposal ${payload.proposalId.substring(0, 12)}...?`,
        default: false,
      }
    );
    if (!confirmed) {
      return {
        status: 'cancelled',
        data: {
          proposalId: payload.proposalId,
          files: proposal.changes.map((c) => c.filePath),
        },
      };
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
