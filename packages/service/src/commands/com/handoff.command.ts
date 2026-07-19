import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  Agent,
  ChatMessage,
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  IChatRuntime,
  IAgentManager,
  ILlmService,
  IEmitService,
  ISessionManager,
  IThreadManager,
} from '@ai-team/core';
import { HANDOFF_AUTO_REACT_MESSAGE } from '../../workflow/chat/handoff-auto-react.js';

type Params = z.infer<typeof HandoffCommand.schema>;
const _handoffCommandSchema = z.object({
  targetAgentId: z.string().min(1).describe('ID of the agent to hand off to'),
  briefingNote: z
    .string()
    .min(1)
    .describe(
      'Final, dominant instruction for the target agent. This is the last word — what the target should actually do.'
    ),
  summary: z
    .string()
    .optional()
    .describe(
      'Optional summary of the prior conversation. Prepended to the briefing note as context. The briefing note remains the dominant message.'
    ),
});

export const HandoffCommandMetadata = {
  key: 'handoff',
  description:
    'Transfer the current conversation to another agent who is better suited ' +
    'to handle the request. Use when a task is outside your area of responsibility. ' +
    'You must have delegation permission to the target agent.',
  availableIn: { tool: true },
  group: 'com',
  parameters: _handoffCommandSchema,
  permissionCheck: { type: 'agent-delegation' as const, argsPath: 'targetAgentId' },
  tags: ['orchestration'],
} satisfies ICommandDescriptor;

export class HandoffCommand implements ICommand<Params, string> {
  static readonly schema = _handoffCommandSchema;
  readonly metadata = HandoffCommandMetadata;

  constructor(
    private readonly agentManager: IAgentManager,
    private readonly sessionManager: ISessionManager,
    private readonly threadManager: IThreadManager,
    private readonly llmService: ILlmService,
    private readonly emitService: IEmitService,
    private readonly chatRuntime: IChatRuntime
  ) {}

  async execute(params: Params, context: ExecutionContext): Promise<CommandResponse<string>> {
    const { targetAgentId, briefingNote, summary } = params;

    const target =
      (await this.agentManager.getAgentAsync(targetAgentId)) ??
      (await this.agentManager.getAllAgentsAsync()).find((candidate) => {
        const query = targetAgentId.trim().toLowerCase();
        return (
          candidate.id.toLowerCase() === query ||
          candidate.name.toLowerCase() === query ||
          candidate.role.toLowerCase() === query
        );
      });

    if (!target) {
      throw new Error(
        `Agent not found: "${targetAgentId}". ` + 'Use who_should to discover valid agent IDs.'
      );
    }

    const fromAgent = context.agent!;
    const fromSessionId = context.sessionId!;
    if (fromAgent.id === target.id) {
      throw new Error('Cannot hand off to yourself. Choose another agent.');
    }

    // Prepend summary (context) before the briefing note (dominant final instruction).
    const composedBriefing = summary?.trim()
      ? `## Prior context\n\n${summary.trim()}\n\n## Your task\n\n${briefingNote}`
      : briefingNote;

    // Resolve target session: one session per agent per thread.
    const currentSession = await this.sessionManager.getSession(fromSessionId);
    const developerId = currentSession?.developerId ?? 'unknown';
    const { session: toSession } = await this.threadManager.resolveHandoffSession(
      target.id,
      fromSessionId,
      developerId
    );
    const toSessionId = toSession.id;

    // Generate LLM-written briefing.
    const briefingContent = await this.generateHandoffBriefing(
      context,
      fromAgent,
      target,
      developerId,
      composedBriefing
    );

    // Persist briefing to both sessions.
    const handoffId = randomUUID();
    const briefingMsg: ChatMessage = {
      from: fromAgent.id,
      to: target.id,
      content: briefingContent,
      timestamp: new Date().toISOString(),
      isHuman: false,
      handoffType: 'agent-briefing',
      handoffFromSessionId: fromSessionId,
      handoffToSessionId: toSessionId,
      handoffId,
    };

    const history = await this.sessionManager.getSessionMessages(toSessionId);
    history.push(briefingMsg);
    await this.sessionManager.appendMessage(toSessionId, briefingMsg);
    await this.sessionManager.appendMessage(fromSessionId, briefingMsg);

    // Emit handoff event — CLI renders "FromAgent → ToAgent" + briefing.
    this.emitService.emit({
      kind: 'handoff',
      fromAgentId: fromAgent.id,
      fromAgentName: fromAgent.name,
      fromAgentRole: fromAgent.role,
      fromSessionId,
      toAgentId: target.id,
      toAgentName: target.name,
      toAgentRole: target.role,
      toSessionId,
      handoffNote: composedBriefing,
      briefingContent,
    });

    // Emit agent_info — CLI updates agent name/color for subsequent tokens.
    this.emitService.emit({
      kind: 'agent_info',
      agentId: target.id,
      agentName: target.name,
      agentRole: target.role,
      llmModel: target.resolvedLlm?.model,
    });

    // Switch context to target agent/session.
    context.agent = target;
    context.sessionId = toSessionId;
    context.history = history;

    // Signal subworkflow start — CLI/web prepare to render target agent's tokens.
    this.emitService.emit({
      kind: 'subworkflow_start',
      agentId: target.id,
      agentName: target.name,
      agentRole: target.role,
      sessionId: toSessionId,
    });

    // Start subworkflow: target agent runs a full chat loop with auto-react message.
    const subworkflowDepth = (context.subworkflowDepth ?? 0) + 1;
    const result = await this.chatRuntime.runAsync({
      message: HANDOFF_AUTO_REACT_MESSAGE,
      agentId: target.id,
      sessionId: toSessionId,
      maxHops: 8,
      signal: context.signal,
      subworkflowDepth,
    });

    // Signal subworkflow end.
    this.emitService.emit({
      kind: 'subworkflow_end',
      agentId: target.id,
      agentName: target.name,
      status: result.status,
      hopCount: result.hopCount,
    });

    if (result.status === 'failed') {
      throw new Error(`Handoff subworkflow failed: ${result.error || 'unknown error'}`);
    }

    // Return a compact summary — the full response already streamed live via token events.
    // The LLM gets this as tool result; the CLI/web render it as a single summary line.
    const resultSummary = result.text.trim().split('\n').slice(0, 3).join(' ').slice(0, 500);

    return {
      status: 'ok',
      data: resultSummary,
    };
  }

  private async generateHandoffBriefing(
    ctx: ExecutionContext,
    fromAgent: Agent,
    toAgent: Agent,
    developerName: string,
    triggerMessage: string
  ): Promise<string> {
    try {
      const recentHistory = ctx.history.slice(-12);
      const historyText = recentHistory
        .map((m) => `${m.isHuman ? developerName : m.from}: ${m.content}`)
        .join('\n');

      const agentTitle = fromAgent.role ? `${fromAgent.name} (${fromAgent.role})` : fromAgent.name;

      const reply = await this.llmService.chat(
        fromAgent,
        [
          {
            role: 'user',
            content:
              `You are ${agentTitle}. ` +
              `Write a handoff briefing for ${toAgent.name}.\n` +
              (triggerMessage ? `${developerName} said: "${triggerMessage}"\n\n` : '') +
              (historyText ? `Recent conversation:\n${historyText}\n\n` : '') +
              `Write 2-10 sentences in first person as ${fromAgent.name}: summarise what you and ` +
              `${developerName} discussed, what ${developerName}'s goal is, and why you are ` +
              `forwarding them to ${toAgent.name}. ` +
              `Do not repeat the request word-for-word. Do not add a subject line or greeting.`,
          },
        ],
        { maxTokens: 250 }
      );
      return reply.trim();
    } catch {
      return triggerMessage || `Handoff from ${fromAgent.name} to ${toAgent.name}.`;
    }
  }
}
