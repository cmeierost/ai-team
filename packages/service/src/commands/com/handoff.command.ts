import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  IEmitService,
  HandoffRequest,
  HandoffCommandResult,
  HandoffCancelledResult,
  IAgentManager,
  ICommandDispatcher,
} from '@ai-team/core';
import { HandoffSubWorkflow } from '../../workflow/chat/handoff-subworkflow.js';

type Params = z.infer<typeof HandoffCommand.schema>;
const _handoffCommandSchema = z.object({
  targetAgentId: z.string().min(1).describe('ID of the agent to hand off to'),
  targetWorkflowId: z
    .string()
    .optional()
    .default('chat')
    .describe('Workflow to run after handoff. Defaults to "chat".'),
  briefingNote: z
    .string()
    .optional()
    .describe(
      'Optional final instruction for the target agent. If omitted, handoff proceeds with an auto-generated briefing from conversation context.'
    ),
  workflowToolPolicy: z
    .object({
      allow: z.array(z.string()).optional(),
      deny: z.array(z.string()).optional(),
      add: z.array(z.string()).optional(),
      remove: z.array(z.string()).optional(),
    })
    .optional()
    .describe('Optional workflow tool policy overlay for the handoff target workflow.'),
});

export const HandoffCommandMetadata = {
  key: 'handoff',
  usage: 'handoff <targetAgentId> [briefingNote]',
  aliases: ['ho'],
  description:
    'Transfer the current conversation to another agent who is better suited ' +
    'to handle the request. Use when a task is outside your area of responsibility. ' +
    'Unconfigured agent targets require developer approval.',
  availableIn: { tool: true, chat: true },
  group: 'com',
  parameters: _handoffCommandSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration'],
} satisfies ICommandDescriptor;

export class HandoffCommand implements ICommand<Params, HandoffCommandResult> {
  static readonly schema = _handoffCommandSchema;
  readonly metadata = HandoffCommandMetadata;

  constructor(
    private readonly handoffSubWorkflow: HandoffSubWorkflow,
    private readonly emitService: IEmitService,
    private readonly agentManager: Pick<
      IAgentManager,
      'resolveAgentForOperationAsync' | 'getAgentAsync'
    >,
    private readonly commandDispatcher: ICommandDispatcher
  ) {}

  async execute(
    params: Params,
    context: ExecutionContext
  ): Promise<CommandResponse<HandoffCommandResult>> {
    const { targetAgentId, targetWorkflowId, briefingNote, workflowToolPolicy } = params;
    const composedBriefing = briefingNote?.trim();
    const resolvedTarget = await this.agentManager.resolveAgentForOperationAsync(
      targetAgentId,
      'chat handoff'
    );
    const targetAgent = await this.agentManager.getAgentAsync(resolvedTarget.id);
    if (!targetAgent) {
      return { status: 'error', message: `No agent found matching: "${targetAgentId}"` };
    }
    const sourceAgent =
      context.agent ??
      (context.agentId ? await this.agentManager.getAgentAsync(context.agentId) : undefined);
    const isSlashInvocation = context.invocationSurface === 'slash';
    if (targetAgent.id === sourceAgent?.id) {
      return {
        status: 'error',
        message: isSlashInvocation
          ? `You are already talking to ${targetAgent.name}. Choose another agent for the handoff.`
          : 'Cannot hand off to yourself. Choose another agent.',
      };
    }

    const isTrustedHumanSlash = isSlashInvocation && context.calledByHuman === true;
    const isConfiguredTarget = (sourceAgent?.handoffs ?? []).some(
      (handoff) => handoff.agent === targetAgent.id
    );

    if (!isTrustedHumanSlash && !isConfiguredTarget) {
      const approvalContext =
        sourceAgent && !context.agent ? { ...context, agent: sourceAgent } : context;
      const approval = await this.commandDispatcher.dispatch(
        'com-ask',
        {
          kind: 'confirm',
          message: `${sourceAgent?.name ?? 'The current agent'} wants to hand the conversation to ${targetAgent.name}${targetAgent.role ? ` (${targetAgent.role})` : ''}. Allow this handoff?`,
          defaultBoolean: false,
        },
        approvalContext
      );
      const answer =
        approval.status === 'ok' &&
        typeof approval.data === 'object' &&
        approval.data !== null &&
        (approval.data as { answer?: unknown }).answer === true;
      if (!answer) {
        const approvalMessage =
          approval.status === 'ok'
            ? 'Handoff was not approved.'
            : approval.message || 'Handoff approval was unavailable.';
        const reasonCode: HandoffCancelledResult['reasonCode'] =
          approval.status === 'cancelled'
            ? 'approval-cancelled'
            : approval.status === 'error'
              ? /timed?\s*out|timeout/i.test(approvalMessage)
                ? 'approval-timeout'
                : 'approval-unavailable'
              : 'approval-denied';
        const cancelled = {
          type: 'handoff_cancelled' as const,
          outcome: 'cancelled' as const,
          targetAgentId: targetAgent.id,
          reasonCode,
          message: approvalMessage,
          timestamp: new Date().toISOString(),
        };
        return {
          status: 'cancelled',
          message: approvalMessage,
          data: cancelled,
        };
      }
    }

    const transitionContext =
      sourceAgent && !context.agent ? { ...context, agent: sourceAgent } : context;
    const transition = await this.handoffSubWorkflow.executeAsync({
      ctx: transitionContext,
      targetAgentQuery: targetAgent.id,
      handoffNote: composedBriefing && composedBriefing.length > 0 ? composedBriefing : undefined,
    });

    context.agent = transition.targetAgent;
    context.agentId = transition.targetAgent.id;
    context.sessionId = transition.toSessionId;
    context.history = transition.history;

    context.navStack = [...transition.navigationStack];

    this.emitService.emit({
      kind: 'session_switched',
      agentId: transition.targetAgent.id,
      sessionId: transition.toSessionId,
      source: 'handoff',
    });

    const handoffRequest: HandoffRequest = {
      type: 'handoff',
      targetAgentId: transition.targetAgent.id,
      briefingNote:
        composedBriefing && composedBriefing.length > 0
          ? composedBriefing
          : transition.briefingContent,
      targetSessionId: transition.toSessionId,
      targetWorkflowId: targetWorkflowId ?? 'chat',
      workflowToolPolicy,
      timestamp: new Date().toISOString(),
    };

    return {
      status: 'ok',
      data: handoffRequest,
    };
  }
}
