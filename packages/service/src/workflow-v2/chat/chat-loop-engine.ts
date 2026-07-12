import { WorkflowV2AbortError } from '../types.js';
import { WorkflowV2ErrorFormatter } from '../error-formatter.js';

export interface ChatLoopV2ToolCall {
  toolName: string;
  args?: unknown;
}

export interface ChatLoopV2PreturnResult {
  outcome: 'consumed' | 'forwarded' | 'continue';
  text?: string;
  autoMessage?: string;
}

export interface ChatLoopV2SendTurnResult {
  text: string;
  toolRoundNeeded: boolean;
  pendingToolCall?: ChatLoopV2ToolCall;
}

export interface ChatLoopV2ToolRoundResult {
  outcome: 'resume_llm' | 'tool_complete' | 'tool_failed';
  error?: string;
}

export interface ChatLoopV2PostTurnResolutionResult {
  outcome: 'normal_complete' | 'handoff_required';
  handoffTargetId?: string;
  handoffTargetSessionId?: string;
  handoffNote?: string;
}

export interface ChatLoopV2HandoffTransitionResult {
  autoMessage?: string;
}

export interface ChatLoopV2FailureInput {
  error: string;
  hop: number;
  state:
    | 'preturn'
    | 'sendTurn'
    | 'toolRound'
    | 'postTurnResolution'
    | 'handoffTransition'
    | 'aborted';
}

export interface ChatLoopV2Input {
  message: string;
  maxHops?: number;
  autoReactMessage?: string;
}

export interface ChatLoopV2Output {
  status: 'completed' | 'failed' | 'max_hops_reached';
  text: string;
  hopCount: number;
  error?: string;
}

export interface IChatLoopV2Services {
  runPreturnInterceptorsAsync(input: { message: string }): Promise<ChatLoopV2PreturnResult>;
  runSendTurnAsync(input: { message: string; hop: number }): Promise<ChatLoopV2SendTurnResult>;
  runPostTurnResolutionAsync(input: {
    text: string;
    hop: number;
  }): Promise<ChatLoopV2PostTurnResolutionResult>;
  runHandoffTransitionAsync(input: {
    handoff: ChatLoopV2PostTurnResolutionResult;
    hop: number;
  }): Promise<ChatLoopV2HandoffTransitionResult>;
  runToolRoundAsync?(input: {
    toolCall: ChatLoopV2ToolCall;
    hop: number;
    lastText: string;
  }): Promise<ChatLoopV2ToolRoundResult>;
  runFailureAsync?(input: ChatLoopV2FailureInput): Promise<void> | void;
}

export interface ChatLoopV2EngineOptions {
  defaultMaxHops?: number;
  defaultAutoReactMessage?: string;
}

export class ChatLoopEngineV2 {
  private readonly defaultMaxHops: number;
  private readonly defaultAutoReactMessage: string;
  private readonly errorFormatter: WorkflowV2ErrorFormatter;

  constructor(options: ChatLoopV2EngineOptions = {}) {
    this.defaultMaxHops = options.defaultMaxHops ?? 10;
    this.defaultAutoReactMessage =
      options.defaultAutoReactMessage ??
      '[Handoff received] You have just been handed this conversation. Review the briefing above, acknowledge the context, and ask the developer how they would like to proceed.';
    this.errorFormatter = new WorkflowV2ErrorFormatter();
  }

  async runAsync(input: ChatLoopV2Input, services: IChatLoopV2Services): Promise<ChatLoopV2Output> {
    const maxHops = input.maxHops ?? this.defaultMaxHops;
    const autoReactMessage = input.autoReactMessage ?? this.defaultAutoReactMessage;

    let hop = 0;
    let currentMessage = input.message;
    let lastText = '';

    try {
      const preturn = await services.runPreturnInterceptorsAsync({ message: currentMessage });

      if (preturn.outcome === 'consumed') {
        return {
          status: 'completed',
          text: preturn.text ?? '',
          hopCount: hop,
        };
      }

      if (preturn.outcome === 'forwarded') {
        currentMessage = preturn.autoMessage ?? autoReactMessage;
      }

      while (true) {
        const sendTurn = await services.runSendTurnAsync({ message: currentMessage, hop });
        lastText = sendTurn.text;

        if (sendTurn.toolRoundNeeded) {
          const toolRoundResult = await this.runToolRoundAsync(services, {
            toolCall: sendTurn.pendingToolCall,
            hop,
            lastText,
          });

          if (toolRoundResult.outcome === 'resume_llm') {
            continue;
          }

          if (toolRoundResult.outcome === 'tool_failed') {
            const errorMessage = toolRoundResult.error ?? 'Tool round failed.';
            await this.runFailureAsync(services, {
              error: errorMessage,
              hop,
              state: 'toolRound',
            });
            return {
              status: 'failed',
              text: lastText,
              hopCount: hop,
              error: errorMessage,
            };
          }
        }

        const postTurn = await services.runPostTurnResolutionAsync({ text: lastText, hop });
        if (postTurn.outcome === 'normal_complete') {
          return {
            status: 'completed',
            text: lastText,
            hopCount: hop,
          };
        }

        if (hop >= maxHops) {
          return {
            status: 'max_hops_reached',
            text: lastText,
            hopCount: hop,
          };
        }

        const handoff = await services.runHandoffTransitionAsync({ handoff: postTurn, hop });
        currentMessage = handoff.autoMessage ?? autoReactMessage;
        hop += 1;
      }
    } catch (error) {
      if (error instanceof WorkflowV2AbortError) {
        await this.runFailureAsync(services, {
          error: error.message,
          hop,
          state: 'aborted',
        });
        return {
          status: 'failed',
          text: lastText,
          hopCount: hop,
          error: error.message,
        };
      }

      const message = this.errorFormatter.format(error);
      await this.runFailureAsync(services, {
        error: message,
        hop,
        state: this.resolveFailureState(error),
      });
      return {
        status: 'failed',
        text: lastText,
        hopCount: hop,
        error: message,
      };
    }
  }

  private async runToolRoundAsync(
    services: IChatLoopV2Services,
    input: { toolCall?: ChatLoopV2ToolCall; hop: number; lastText: string }
  ): Promise<ChatLoopV2ToolRoundResult> {
    if (!input.toolCall) {
      return {
        outcome: 'tool_failed',
        error: 'Tool round requested without pending tool call.',
      };
    }

    if (!services.runToolRoundAsync) {
      return {
        outcome: 'tool_failed',
        error: 'No tool round service configured.',
      };
    }

    return services.runToolRoundAsync({
      toolCall: input.toolCall,
      hop: input.hop,
      lastText: input.lastText,
    });
  }

  private async runFailureAsync(services: IChatLoopV2Services, input: ChatLoopV2FailureInput) {
    await services.runFailureAsync?.(input);
  }

  private resolveFailureState(error: unknown): ChatLoopV2FailureInput['state'] {
    if (!(error instanceof Error)) {
      return 'sendTurn';
    }

    const lower = error.message.toLowerCase();
    if (lower.includes('preturn')) return 'preturn';
    if (lower.includes('postturn')) return 'postTurnResolution';
    if (lower.includes('handoff')) return 'handoffTransition';
    if (lower.includes('tool')) return 'toolRound';
    return 'sendTurn';
  }
}
