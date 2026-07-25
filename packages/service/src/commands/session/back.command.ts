import type { CommandResponse, ExecutionContext, ICommand, ICommandDescriptor } from '@ai-team/core';
import type { WorkflowInteractionRouter } from '../../workflow/workflow-interaction-router.js';

export const BackChatCommandMetadata = {
  key: 'back',
  aliases: ['back'],
  description: 'Request the active workflow chat child to take its explicit back/abandon transition.',
  availableIn: { chat: true, tool: false, cli: false },
  group: 'session',
} satisfies ICommandDescriptor;

export class BackChatCommand implements ICommand<Record<string, never>, unknown> {
  readonly metadata = BackChatCommandMetadata;

  constructor(
    private readonly workflowInteractions?: Pick<
      WorkflowInteractionRouter,
      'resolveActiveInteraction' | 'dispatch'
    >
  ) {}

  async execute(
    _args: Record<string, never>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    if (!ctx.sessionId || !this.workflowInteractions) {
      return {
        status: 'error',
        message: 'No active workflow interaction to go back from.',
      };
    }

    const interaction = await this.workflowInteractions.resolveActiveInteraction(ctx.sessionId);
    if (!interaction) {
      return {
        status: 'error',
        message: 'No active workflow interaction to go back from.',
      };
    }

    let routedInteraction = interaction;
    const dispatchBackAttempt = async (expected: { sessionId: string; cursor: string }) => {
      await this.workflowInteractions?.dispatch(
        expected.sessionId,
        { type: 'BACK_ATTEMPT' },
        expected.cursor
      );
    };

    try {
      await dispatchBackAttempt(interaction);
    } catch (error) {
      if (!this.isCursorMismatchError(error)) {
        throw error;
      }
      const refreshed = await this.workflowInteractions.resolveActiveInteraction(ctx.sessionId);
      if (!refreshed) {
        throw error;
      }
      routedInteraction = refreshed;
      await dispatchBackAttempt(refreshed);
    }

    return {
      status: 'ok',
      message: 'Workflow back transition is being processed.',
      data: {
        workflowRunId: routedInteraction.runId,
        interactionCursor: routedInteraction.cursor,
      },
    };
  }

  private isCursorMismatchError(error: unknown): boolean {
    return error instanceof Error && /interaction cursor mismatch/i.test(error.message);
  }
}

