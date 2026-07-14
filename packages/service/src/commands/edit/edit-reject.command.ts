import { z } from 'zod';
import type {
  ICommand,
  ICodeEditManager,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import { ProposalStatus } from '@ai-team/core';
import type { IQuestionService } from '../../interaction/question-service.js';

type RejectParams = z.infer<typeof CodeEditRejectCommand.schema>;
const _codeEditRejectCommandSchema = z.object({
  proposalId: z.string().describe('Proposal id to reject'),
  reason: z.string().optional().describe('Optional rejection reason'),
});

export const CodeEditRejectCommandMetadata = {
  key: 'reject',
  group: 'edit',
  description: 'Reject a code edit proposal',
  availableIn: { cli: true, chat: true, tool: true },
  parameters: _codeEditRejectCommandSchema,
} satisfies ICommandDescriptor;

export class CodeEditRejectCommand implements ICommand<RejectParams, { proposalId: string }> {
  static readonly schema = _codeEditRejectCommandSchema;
  readonly metadata = CodeEditRejectCommandMetadata;

  constructor(
    private readonly manager: ICodeEditManager,
    private readonly questionService: IQuestionService
  ) {}

  async execute(
    payload: RejectParams,
    _ctx: ExecutionContext
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
      reason = await this.questionService.input({
        message: 'Reason for rejection (optional):',
      });
    }

    this.manager.rejectProposal(payload.proposalId, reason || 'Rejected by user');
    return { status: 'ok', data: { proposalId: payload.proposalId } };
  }
}
