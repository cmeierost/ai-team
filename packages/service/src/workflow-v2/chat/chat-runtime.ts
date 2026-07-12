import {
  ChatLoopEngineV2,
  type ChatLoopV2FailureInput,
  type ChatLoopV2Input,
  type ChatLoopV2Output,
  type ChatLoopV2PostTurnResolutionResult,
  type ChatLoopV2ToolCall,
  type IChatLoopV2Services,
} from './chat-loop-engine.js';

export interface ChatRuntimeV2TurnInput {
  userMessage: string;
  hop: number;
  options: {
    skipPersist: boolean;
  };
}

export interface ChatRuntimeV2TurnResult {
  text: string;
  toolRoundNeeded: boolean;
  pendingToolCall?: ChatLoopV2ToolCall;
}

export interface IChatRuntimeV2Dependencies {
  runPreturnInterceptorsAsync: IChatLoopV2Services['runPreturnInterceptorsAsync'];
  runSendTurnAsync(input: ChatRuntimeV2TurnInput): Promise<ChatRuntimeV2TurnResult>;
  runPostTurnResolutionAsync: IChatLoopV2Services['runPostTurnResolutionAsync'];
  runHandoffTransitionAsync: IChatLoopV2Services['runHandoffTransitionAsync'];
  runToolRoundAsync?: IChatLoopV2Services['runToolRoundAsync'];
  runFailureAsync?: IChatLoopV2Services['runFailureAsync'];
}

export interface ChatRuntimeV2RunInput extends ChatLoopV2Input {
  agentId?: string;
  sessionId?: string;
}

export interface IChatRuntimeV2 {
  runAsync(input: ChatRuntimeV2RunInput): Promise<ChatLoopV2Output>;
}

export class ChatRuntimeV2 implements IChatRuntimeV2 {
  private activeAutoReactMessage?: string;

  constructor(
    private readonly deps: IChatRuntimeV2Dependencies,
    private readonly loopEngine: ChatLoopEngineV2
  ) {}

  async runAsync(input: ChatRuntimeV2RunInput): Promise<ChatLoopV2Output> {
    this.activeAutoReactMessage = input.autoReactMessage;

    try {
      return await this.loopEngine.runAsync(input, {
        runPreturnInterceptorsAsync: (nextInput) =>
          this.deps.runPreturnInterceptorsAsync(nextInput),
        runSendTurnAsync: (nextInput) =>
          this.deps.runSendTurnAsync({
            userMessage: nextInput.message,
            hop: nextInput.hop,
            options: {
              skipPersist: this.shouldSkipPersist(nextInput.message, nextInput.hop),
            },
          }),
        runPostTurnResolutionAsync: (nextInput) => this.deps.runPostTurnResolutionAsync(nextInput),
        runHandoffTransitionAsync: (nextInput) => this.deps.runHandoffTransitionAsync(nextInput),
        runToolRoundAsync: this.deps.runToolRoundAsync
          ? (nextInput) => this.deps.runToolRoundAsync!(nextInput)
          : undefined,
        runFailureAsync: this.deps.runFailureAsync
          ? (nextInput) => this.deps.runFailureAsync!(nextInput)
          : undefined,
      });
    } finally {
      this.activeAutoReactMessage = undefined;
    }
  }

  private shouldSkipPersist(message: string, hop: number): boolean {
    if (hop > 0) {
      return true;
    }

    if (!this.activeAutoReactMessage) {
      return false;
    }

    return message === this.activeAutoReactMessage;
  }
}
