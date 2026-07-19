import { randomUUID } from 'node:crypto';
import type {
  Agent,
  ChatMessage,
  IAgentManager,
  ILlmService,
  IEmitService,
  ICommand,
  CommandResponse,
  ExecutionContext,
  ICommandDescriptor,
  ISessionManager,
  IThreadManager,
} from '@ai-team/core';
import { HANDOFF_AUTO_REACT_MESSAGE } from '../../workflow/chat/handoff-auto-react.js';

export const HandoffChatCommandMetadata = {
  key: 'handoff',
  usage: 'handoff <agent|role> [| optional-note]',
  description:
    'Hand off the current conversation to another agent. The system will generate a briefing automatically and the target agent will continue the conversation.',
  aliases: ['ho'],
  availableIn: { chat: true, tool: false },
  group: 'session',
} satisfies ICommandDescriptor;

interface HandoffPromptForwardData {
  source: 'prompt';
  promptText: string;
}

export class HandoffChatCommand implements ICommand<unknown, HandoffPromptForwardData> {
  readonly metadata = HandoffChatCommandMetadata;
  private readonly agentManager: IAgentManager;
  private readonly sessionManager: ISessionManager;
  private readonly threadManager: IThreadManager;
  private readonly llmService: ILlmService;
  private readonly emitService: IEmitService;

  constructor(
    agentManager: IAgentManager,
    sessionManager: ISessionManager,
    threadManager: IThreadManager,
    llmService: ILlmService,
    emitService: IEmitService
  ) {
    this.agentManager = agentManager;
    this.sessionManager = sessionManager;
    this.threadManager = threadManager;
    this.llmService = llmService;
    this.emitService = emitService;
  }

  async execute(
    args: unknown,
    ctx: ExecutionContext
  ): Promise<CommandResponse<HandoffPromptForwardData>> {
    if (!ctx.agent?.id || !ctx.sessionId) {
      return {
        status: 'error',
        message: 'Handoff is only available inside an active chat session.',
      };
    }

    const normalizedArgs = this.normalizeArgs(args);
    const { targetQuery, note } = this.parseArgs(normalizedArgs);

    if (!targetQuery) {
      return { status: 'error', message: 'Usage: /handoff <agent|role> [| optional-note]' };
    }

    const matches = await this.agentManager.resolveAgentAsync(targetQuery);
    if (matches.length === 0) {
      return { status: 'error', message: `No agent found matching: "${targetQuery}"` };
    }

    const target: Agent = matches.find((a: Agent) => a.id !== ctx.agent?.id) ?? matches[0];
    if (target.id === ctx.agent?.id) {
      return { status: 'ok', message: `Already talking to ${ctx.agent?.name}.` };
    }

    const switched = await this.executeHandoffInline(ctx, target, note);
    if (!switched) {
      return {
        status: 'error',
        message: `Failed to hand off to ${target.name}. Please verify the target and try again.`,
      };
    }

    return {
      status: 'ok',
      message: `\nSwitching to ${target.name} (${target.role})...\n`,
      data: {
        source: 'prompt',
        promptText: HANDOFF_AUTO_REACT_MESSAGE,
      },
    };
  }

  private async executeHandoffInline(
    ctx: ExecutionContext,
    target: Agent,
    handoffNote?: string
  ): Promise<boolean> {
    const fromAgent = ctx.agent!;
    const fromSessionId = ctx.sessionId!;

    const currentSession = await this.sessionManager.getSession(fromSessionId);
    const developerId = currentSession?.developerId ?? 'unknown';

    const { session: toSession } = await this.threadManager.resolveHandoffSession(
      target.id,
      fromSessionId,
      developerId
    );
    const toSessionId = toSession.id;

    const briefingContent = await this.generateHandoffBriefing(
      ctx,
      fromAgent,
      target,
      developerId,
      handoffNote ?? ''
    );

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
      handoffNote,
      briefingContent,
    });

    this.emitService.emit({
      kind: 'agent_info',
      agentId: target.id,
      agentName: target.name,
      agentRole: target.role,
      llmModel: target.resolvedLlm?.model,
    });

    ctx.agent = target;
    ctx.sessionId = toSessionId;
    ctx.history = history;

    return true;
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

  private normalizeArgs(args: unknown): string {
    if (typeof args === 'string') {
      return args.trim();
    }

    if (args && typeof args === 'object') {
      const positional = (args as { _?: unknown })._;
      if (Array.isArray(positional)) {
        const tokens = positional.filter((v): v is string => typeof v === 'string');
        if (tokens.length > 0) {
          return tokens.join(' ').trim();
        }
      }

      const direct = (args as { target?: unknown }).target;
      if (typeof direct === 'string' && direct.trim().length > 0) {
        return direct.trim();
      }
    }

    return '';
  }

  private parseArgs(raw: string): { targetQuery: string; note?: string } {
    const [targetPart, ...noteParts] = raw.split('|');
    const targetQuery = targetPart?.trim() ?? '';
    const noteJoined = noteParts.join('|').trim();
    return {
      targetQuery,
      note: noteJoined.length > 0 ? noteJoined : undefined,
    };
  }
}
