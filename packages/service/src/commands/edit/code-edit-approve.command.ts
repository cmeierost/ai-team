import { z } from 'zod';
import type { ICommand, ICodeEditManager, ExecutionContext, CommandResponse } from '@ai-team/core';
import { ProposalStatus } from '@ai-team/core';

type ApproveParams = z.infer<typeof CodeEditApproveCommand.schema>;

export class CodeEditApproveCommand implements ICommand<ApproveParams, { proposalId: string }> {
  static readonly schema = z.object({
    proposalId: z.string().describe('Proposal id to approve'),
  });

  readonly key = 'codeEditApprove';
  readonly cli = { command: 'code-edit approve <proposalId>' };
  readonly description = 'Approve a code edit proposal';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = CodeEditApproveCommand.schema;

  constructor(private readonly manager: ICodeEditManager) {}

  async execute(
    payload: ApproveParams,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<{ proposalId: string }>> {
    const proposal = this.manager.getProposal(payload.proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${payload.proposalId} not found`);
    }
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new Error(`Proposal ${payload.proposalId} is not pending (status: ${proposal.status})`);
    }
    this.manager.approveProposal(payload.proposalId);
    return { status: 'ok', data: { proposalId: payload.proposalId } };
  }
}
