import type {
  Agent,
  IAgentManager,
  ILlmService,
  IEmitService,
  ICommand,
  CommandResponse,
  ExecutionContext,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SessionManager } from '../../sessions/session-manager.js';
import { ChatHandoffTransitionService } from '../../workflow/chat/chat-handoff-transition.js';
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
  private readonly handoffTransitionService: ChatHandoffTransitionService;
  private readonly agentManager: IAgentManager;

  constructor(
    agentManager: IAgentManager,
    sessionManager: SessionManager,
    llmService: ILlmService,
    emitService: IEmitService
  ) {
    this.agentManager = agentManager;
    this.handoffTransitionService = new ChatHandoffTransitionService(
      agentManager,
      sessionManager,
      llmService,
      emitService
    );
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

    const switched = await this.handoffTransitionService.executeHandoff(
      ctx,
      target.id,
      undefined,
      note
    );
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
