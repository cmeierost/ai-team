import { z } from 'zod';
import type {
  ICommand,
  ICodeEditManager,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import { ProposalStatus } from '@ai-team/core';

type ApproveParams = z.infer<typeof CodeEditApproveCommand.schema>;
const _codeEditApproveCommandSchema = z.object({
  proposalId: z.string().describe('Proposal id to approve'),
});

export const CodeEditApproveCommandMetadata = {
  key: 'approve',
  group: 'edit',
  description: 'Approve a code edit proposal',
  availableIn: { cli: true, chat: true, tool: true },
  parameters: _codeEditApproveCommandSchema,
} satisfies ICommandDescriptor;

export class CodeEditApproveCommand implements ICommand<ApproveParams, { proposalId: string }> {
  static readonly schema = _codeEditApproveCommandSchema;
  readonly metadata = CodeEditApproveCommandMetadata;

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
