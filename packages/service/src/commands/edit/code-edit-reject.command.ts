import { z } from 'zod';
import type { ICommand, ICodeEditManager, ExecutionContext, CommandResponse } from '@ai-team/core';
import { ProposalStatus } from '@ai-team/core';
import type { IQuestionService } from '../../questions/question-service.js';

type RejectParams = z.infer<typeof CodeEditRejectCommand.schema>;

export class CodeEditRejectCommand implements ICommand<RejectParams, { proposalId: string }> {
  static readonly schema = z.object({
    proposalId: z.string().describe('Proposal id to reject'),
    reason: z.string().optional().describe('Optional rejection reason'),
  });

  readonly key = 'codeEditReject';
  readonly cli = { command: 'code-edit reject <proposalId>' };
  readonly description = 'Reject a code edit proposal';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = CodeEditRejectCommand.schema;

  constructor(
    private readonly manager: ICodeEditManager,
    private readonly questionService: IQuestionService
  ) {}

  async execute(
    payload: RejectParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<{ proposalId: string }>> {
    const proposal = this.manager.getProposal(payload.proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${payload.proposalId} not found`);
    }
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new Error(`Proposal ${payload.proposalId} is not pending (status: ${proposal.status})`);
    }

    let reason = payload.reason;
    if (!reason) {
      reason = await this.questionService.questionInput({
        message: 'Reason for rejection (optional):',
      });
    }

    this.manager.rejectProposal(payload.proposalId, reason || 'Rejected by user');
    return { status: 'ok', data: { proposalId: payload.proposalId } };
  }
}
