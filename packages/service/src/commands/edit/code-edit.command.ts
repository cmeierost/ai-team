import { z } from 'zod';
import type { ICommand, CommandRuntime } from '@ai-team/core';
import type {
  CodeEditListResponse,
  InteractionContext,
} from '@ai-team/api-contracts';
import { CodeEditService } from './code-edit.js';

type ListParams = z.infer<typeof CodeEditListCommand.schema>;
type ApproveParams = z.infer<typeof CodeEditApproveCommand.schema>;
type RejectParams = z.infer<typeof CodeEditRejectCommand.schema>;
type ApplyParams = z.infer<typeof CodeEditApplyCommand.schema>;

function toInteractionContext(runtime: CommandRuntime): InteractionContext {
  return {
    signal: runtime.signal,
    emit: runtime.emit as InteractionContext['emit'],
    questionInput: runtime.questionInput,
    questionConfirm: runtime.questionConfirm,
    questionSelect: runtime.questionSelect,
    questionPassword: runtime.questionPassword,
    questionChecklist: runtime.questionChecklist,
    workflowState: runtime.workflowState,
    onWorkflowFrame: runtime.onWorkflowFrame,
  };
}

export class CodeEditListCommand implements ICommand<ListParams, void, CodeEditListResponse> {
  static readonly schema = z.object({
    status: z.string().optional().describe('Optional proposal status filter'),
    agent: z.string().optional().describe('Optional agent name filter'),
  });

  readonly key = 'codeEditList';
  readonly cli = { command: 'code-edit list' };
  readonly description = 'List code edit proposals';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = CodeEditListCommand.schema;

  constructor(private readonly codeEditService: CodeEditService) {}

  async execute(payload: ListParams): Promise<CodeEditListResponse> {
    return this.codeEditService.listAsync(payload);
  }
}

export class CodeEditApproveCommand
  implements ICommand<ApproveParams, void, { proposalId: string }>
{
  static readonly schema = z.object({
    proposalId: z.string().describe('Proposal id to approve'),
  });

  readonly key = 'codeEditApprove';
  readonly cli = { command: 'code-edit approve <proposalId>' };
  readonly description = 'Approve a code edit proposal';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = CodeEditApproveCommand.schema;

  constructor(private readonly codeEditService: CodeEditService) {}

  async execute(payload: ApproveParams): Promise<{ proposalId: string }> {
    return this.codeEditService.approveAsync(payload);
  }
}

export class CodeEditRejectCommand
  implements ICommand<RejectParams, void, { proposalId: string }>
{
  static readonly schema = z.object({
    proposalId: z.string().describe('Proposal id to reject'),
    reason: z.string().optional().describe('Optional rejection reason'),
  });

  readonly key = 'codeEditReject';
  readonly cli = { command: 'code-edit reject <proposalId>' };
  readonly description = 'Reject a code edit proposal';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = CodeEditRejectCommand.schema;

  constructor(private readonly codeEditService: CodeEditService) {}

  async execute(
    payload: RejectParams,
    _ctx: void,
    runtime: CommandRuntime
  ): Promise<{ proposalId: string }> {
    return this.codeEditService.rejectAsync(payload, toInteractionContext(runtime));
  }
}

export class CodeEditApplyCommand
  implements ICommand<ApplyParams, void, { proposalId: string; files: string[] }>
{
  static readonly schema = z.object({
    proposalId: z.string().describe('Proposal id to apply'),
  });

  readonly key = 'codeEditApply';
  readonly cli = { command: 'code-edit apply <proposalId>' };
  readonly description = 'Apply an approved code edit proposal';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = CodeEditApplyCommand.schema;

  constructor(private readonly codeEditService: CodeEditService) {}

  async execute(
    payload: ApplyParams,
    _ctx: void,
    runtime: CommandRuntime
  ): Promise<{ proposalId: string; files: string[] }> {
    return this.codeEditService.applyAsync(payload, toInteractionContext(runtime));
  }
}
