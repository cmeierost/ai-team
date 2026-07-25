import { z } from 'zod';
import type {
  ExecutionContext,
  IAgentManager,
  ICommand,
  ICommandDispatcher,
  CommandResponse,
  HandoffRequest,
  ICommandDescriptor,
  IThreadManager,
} from '@ai-team/core';
import type { WorkflowInteractionRouter } from '../../workflow/workflow-interaction-router.js';

const _returnCommandSchema = z.object({
  developerSignal: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Required for agent tool calls: quote the developer’s exact words that clearly request returning/reporting back or confirm the delegated work is finished.'
    ),
});
type ReturnCommandParams = z.infer<typeof _returnCommandSchema>;

export const ReturnChatCommandMetadata = {
  key: 'return',
  aliases: ['return'],
  description:
    'Finish the active workflow using its configured return command, or its last completed tool response by default. Use only after the developer clearly asks to return or confirms the delegated work is complete.',
  availableIn: { chat: true, tool: true },
  group: 'session',
  parameters: _returnCommandSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration'],
  longRunning: true,
} satisfies ICommandDescriptor;

export class ReturnChatCommand implements ICommand<ReturnCommandParams, unknown> {
  static readonly schema = _returnCommandSchema;
  readonly metadata = ReturnChatCommandMetadata;

  constructor(
    private readonly commandDispatcher: ICommandDispatcher,
    private readonly workflowInteractions?: Pick<
      WorkflowInteractionRouter,
      'resolveActiveInteraction' | 'dispatch'
    >
  ) {}

  async execute(
    args: ReturnCommandParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const signalError = this.validateAgentReturnSignal(args, ctx);
    if (signalError) {
      return { status: 'error', message: signalError };
    }

    const interaction = ctx.sessionId
      ? await this.workflowInteractions?.resolveActiveInteraction(ctx.sessionId)
      : null;
    if (interaction && ctx.sessionId) {
      let routedInteraction = interaction;
      const dispatchReturnAttempt = async (
        expected: { sessionId: string; cursor: string }
      ): Promise<void> => {
        await this.workflowInteractions?.dispatch(
          expected.sessionId,
          { type: 'RETURN_ATTEMPT' },
          expected.cursor
        );
      };
      try {
        await dispatchReturnAttempt(interaction);
      } catch (error) {
        if (!this.isCursorMismatchError(error)) {
          throw error;
        }
        const refreshed = await this.workflowInteractions?.resolveActiveInteraction(ctx.sessionId);
        if (!refreshed) {
          throw error;
        }
        routedInteraction = refreshed;
        await dispatchReturnAttempt(refreshed);
      }
      return {
        status: 'ok',
        message: 'Workflow completion is being checked.',
        data: {
          workflowRunId: routedInteraction.runId,
          interactionCursor: routedInteraction.cursor,
        },
      };
    }

    const returnCommand = ctx.workflowReturn;
    if (!returnCommand?.command) {
      if (ctx.workflowLastResult !== undefined) {
        return {
          status: 'ok',
          message: this.describeLastResult(ctx.workflowLastResult),
          data: ctx.workflowLastResult,
        };
      }
      return {
        status: 'error',
        message: `Workflow '${ctx.workflowId ?? 'unknown'}' has no completed tool result to return.`,
      };
    }
    if (returnCommand.command === 'session-return' || returnCommand.command === 'return') {
      return {
        status: 'error',
        message: 'Workflow return command cannot invoke /return recursively.',
      };
    }

    const response = await this.commandDispatcher.dispatch(
      returnCommand.command,
      returnCommand.args ?? {},
      ctx
    );

    return {
      status: response.status,
      message: response.message,
      ...(response.data !== undefined ? { data: response.data } : {}),
      ...(response.error
        ? { error: { message: response.message, ...response.error } }
        : {}),
    };
  }

  private describeLastResult(result: unknown): string {
    if (
      result
      && typeof result === 'object'
      && 'message' in result
      && typeof result.message === 'string'
      && result.message.trim().length > 0
    ) {
      return result.message;
    }
    if (typeof result === 'string') return result;
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return String(result);
    }
  }

  private validateAgentReturnSignal(
    args: ReturnCommandParams,
    ctx: ExecutionContext
  ): string | undefined {
    if (ctx.invocationSurface !== 'tool' && ctx.callerType !== 'agent') {
      return undefined;
    }

    const signal = args.developerSignal?.trim();
    if (!signal) {
      return 'Agent-initiated /return requires the developer’s exact completion or return signal.';
    }

    const normalizedSignal = signal.toLocaleLowerCase();
    const isCurrentDeveloperMessage = [...ctx.history]
      .reverse()
      .filter((message) => message.isHuman && !message.hiddenFromLlm)
      .slice(0, 1)
      .some((message) => message.content.toLocaleLowerCase().includes(normalizedSignal));

    return isCurrentDeveloperMessage
      ? undefined
      : 'The /return developerSignal must quote the latest visible developer message.';
  }

  private isCursorMismatchError(error: unknown): boolean {
    return error instanceof Error && /interaction cursor mismatch/i.test(error.message);
  }
}

export const HandoffWorkflowReturnCommandMetadata = {
  key: 'handoff-return',
  description: 'Summarize the current handoff workflow and return control to its parent',
  availableIn: { cli: false, chat: false, tool: false },
  group: 'session',
  longRunning: true,
} satisfies ICommandDescriptor;

export class HandoffWorkflowReturnCommand
  implements ICommand<Record<string, never>, HandoffRequest>
{
  readonly metadata = HandoffWorkflowReturnCommandMetadata;

  constructor(
    private readonly threadManager: IThreadManager,
    private readonly agentManager: Pick<IAgentManager, 'getAgentAsync'>,
    private readonly commandDispatcher: ICommandDispatcher
  ) {}

  async execute(
    _args: Record<string, never>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<HandoffRequest>> {
    if (!ctx.sessionId) {
      return { status: 'error', message: 'No previous workflow to return to.' };
    }

    const active = await this.threadManager.resolveActiveSession(ctx.sessionId);
    const parent = active.state.navigationStack.at(-1);
    if (!parent) {
      return { status: 'error', message: 'No previous workflow to return to.' };
    }

    const previousAuthorization = ctx.handoffAlreadyAuthorized;
    ctx.handoffAlreadyAuthorized = true;
    let response;
    try {
      response = await this.commandDispatcher.dispatch(
        'com-handoff',
        {
          targetAgentId: parent.agentId,
          targetWorkflowId: 'chat',
          navigationIntent: 'back',
          ...(parent.handoffToolCallId ? { sourceToolCallId: parent.handoffToolCallId } : {}),
          ...(parent.handoffSourceSessionId ? { sourceSessionId: parent.handoffSourceSessionId } : {}),
        },
        ctx
      );
    } finally {
      ctx.handoffAlreadyAuthorized = previousAuthorization;
    }

    if (response.status !== 'ok') {
      return {
        status: response.status,
        message: response.message,
        ...(response.error
          ? { error: { message: response.message, ...response.error } }
          : {}),
      };
    }

    const target = await this.agentManager.getAgentAsync(parent.agentId);
    const handoffRequest = response.data as HandoffRequest | undefined;
    if (!handoffRequest || handoffRequest.type !== 'handoff') {
      return {
        status: 'error',
        message: 'The parent workflow was restored without a handoff result.',
      };
    }

    return {
      status: 'ok',
      message: `← Returned to ${parent.agentName}${target?.role ? ` (${target.role})` : ''}`,
      data: handoffRequest,
    };
  }
}
