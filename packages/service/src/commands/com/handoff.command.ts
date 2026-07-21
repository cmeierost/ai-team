import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  SessionNavEntry,
  IEmitService,
  HandoffRequest,
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
    'You must have delegation permission to the target agent.',
  availableIn: { tool: true, chat: true },
  group: 'com',
  parameters: _handoffCommandSchema,
  permissionCheck: { type: 'agent-delegation' as const, argsPath: 'targetAgentId' },
  tags: ['orchestration'],
} satisfies ICommandDescriptor;

export class HandoffCommand implements ICommand<Params, HandoffRequest> {
  static readonly schema = _handoffCommandSchema;
  readonly metadata = HandoffCommandMetadata;

  constructor(
    private readonly handoffSubWorkflow: HandoffSubWorkflow,
    private readonly emitService: IEmitService
  ) {}

  async execute(
    params: Params,
    context: ExecutionContext
  ): Promise<CommandResponse<HandoffRequest>> {
    const { targetAgentId, targetWorkflowId, briefingNote, workflowToolPolicy } = params;
    const composedBriefing = briefingNote?.trim();

    const transition = await this.handoffSubWorkflow.executeAsync({
      ctx: context,
      targetAgentQuery: targetAgentId,
      handoffNote: composedBriefing && composedBriefing.length > 0 ? composedBriefing : undefined,
    });

    context.agent = transition.targetAgent;
    context.agentId = transition.targetAgent.id;
    context.sessionId = transition.toSessionId;
    context.history = transition.history;

    const navStack = context.navStack ?? [];
    const parentFrame: SessionNavEntry = {
      agentId: transition.fromAgent.id,
      agentName: transition.fromAgent.name,
      sessionId: transition.fromSessionId,
    };
    navStack.push(parentFrame);
    context.navStack = navStack;

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
