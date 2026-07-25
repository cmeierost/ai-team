import { z } from 'zod';
import type { CommandResponse, ExecutionContext, ICommand, ICommandDescriptor } from '@ai-team/core';
import type { WorkflowActorHost } from '../../workflow/workflow-actor-host.js';
import type { WorkflowInteractionRouter } from '../../workflow/workflow-interaction-router.js';

const cancelCommandSchema = z.object({
  confirmation: z.string().optional(),
});

type CancelCommandParams = z.infer<typeof cancelCommandSchema>;

export const CancelChatCommandMetadata = {
  key: 'cancel',
  aliases: ['cancel'],
  description: 'Cancel the active workflow run for this chat session.',
  availableIn: { chat: true, cli: false, tool: false },
  group: 'session',
  parameters: cancelCommandSchema,
} satisfies ICommandDescriptor;

interface CancelCommandOutcome {
  outcome:
    | 'confirmation_required'
    | 'cancelled'
    | 'no_active_workflow'
    | 'workflow_not_loaded';
  cancelled: boolean;
  workflowRunId?: string;
  sessionId?: string;
}

export class CancelChatCommand implements ICommand<CancelCommandParams, CancelCommandOutcome> {
  readonly metadata = CancelChatCommandMetadata;

  constructor(
    private readonly workflowInteractions?: Pick<WorkflowInteractionRouter, 'resolveActiveRun'>,
    private readonly workflowActorHost?: Pick<WorkflowActorHost, 'getLiveRun'>
  ) {}

  async execute(
    args: CancelCommandParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<CancelCommandOutcome>> {
    if (!ctx.sessionId || !this.workflowInteractions || !this.workflowActorHost) {
      return {
        status: 'ok',
        message: 'No active workflow run is associated with this chat session.',
        data: {
          outcome: 'no_active_workflow',
          cancelled: false,
        },
      };
    }

    const run = await this.workflowInteractions.resolveActiveRun(ctx.sessionId);
    if (!run) {
      return {
        status: 'ok',
        message: 'No active workflow run is associated with this chat session.',
        data: {
          outcome: 'no_active_workflow',
          cancelled: false,
          sessionId: ctx.sessionId,
        },
      };
    }

    if (!this.isConfirmed(args.confirmation)) {
      return {
        status: 'ok',
        message: "Cancellation requires confirmation. Re-run '/cancel confirm' to cancel this workflow.",
        data: {
          outcome: 'confirmation_required',
          cancelled: false,
          workflowRunId: run.id,
          sessionId: ctx.sessionId,
        },
      };
    }

    const liveRun = this.workflowActorHost.getLiveRun(run.id);
    if (!liveRun) {
      return {
        status: 'error',
        message: `Workflow run '${run.id}' is active but is not loaded in this process.`,
        data: {
          outcome: 'workflow_not_loaded',
          cancelled: false,
          workflowRunId: run.id,
          sessionId: ctx.sessionId,
        },
      };
    }

    await liveRun.cancel();
    return {
      status: 'ok',
      message: 'Workflow cancellation requested.',
      data: {
        outcome: 'cancelled',
        cancelled: true,
        workflowRunId: run.id,
        sessionId: ctx.sessionId,
      },
    };
  }

  private isConfirmed(confirmation: string | undefined): boolean {
    return confirmation?.trim().toLowerCase() === 'confirm';
  }
}

