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

type ApplyParams = z.infer<typeof CodeEditApplyCommand.schema>;
const _codeEditApplyCommandSchema = z.object({
  proposalId: z.string().describe('Proposal id to apply'),
});

export const CodeEditApplyCommandMetadata = {
  key: 'apply',
  group: 'edit',
  description: 'Apply an approved code edit proposal',
  availableIn: { cli: true, chat: true, tool: true },
  parameters: _codeEditApplyCommandSchema,
} satisfies ICommandDescriptor;

export class CodeEditApplyCommand implements ICommand<
  ApplyParams,
  { proposalId: string; files: string[] }
> {
  static readonly schema = _codeEditApplyCommandSchema;
  readonly metadata = CodeEditApplyCommandMetadata;

  constructor(
    private readonly manager: ICodeEditManager,
    private readonly questionService: IQuestionService
  ) {}

  async execute(
    payload: ApplyParams,
    _ctx: ExecutionContext
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

    const confirmed = await this.questionService.confirm({
      message: `Apply ${proposal.changes.length} file change(s) from proposal ${payload.proposalId.substring(0, 12)}...?`,
      default: false,
    });
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
