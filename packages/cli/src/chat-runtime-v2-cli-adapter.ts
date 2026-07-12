import type { IServiceContainer } from '@ai-team/core';
import type { ICommandDispatcher } from '@ai-team/api-contracts';
import {
  ChatLoopEngineV2,
  ChatRuntimeV2,
  type ChatRuntimeV2TurnInput,
  type ChatRuntimeV2TurnResult,
  type IChatRuntimeV2,
  COMMAND_FACTORY_TOKENS,
} from '@ai-team/service';

export interface ICliChatV2TurnRunner {
  runTurnAsync(input: {
    message: string;
    skipPersist: boolean;
    agentId?: string;
    sessionId?: string;
  }): Promise<string>;
}

export class CliChatV2TurnRunner implements ICliChatV2TurnRunner {
  constructor(
    private readonly serviceContainer: IServiceContainer,
    private readonly commandDispatcher: ICommandDispatcher
  ) {}

  async runTurnAsync(input: {
    message: string;
    skipPersist: boolean;
    agentId?: string;
    sessionId?: string;
  }): Promise<string> {
    const sessionManager = this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.SessionManager);

    let targetAgentId = input.agentId;
    let targetSessionId = input.sessionId;

    if (targetSessionId && !targetAgentId) {
      const explicitSession = await sessionManager.getSession(targetSessionId);
      if (explicitSession?.agentId) {
        targetAgentId = explicitSession.agentId;
      }
    }

    if (!targetAgentId && !targetSessionId) {
      const recent = await sessionManager.listRecentSessions(1);
      if (recent.length > 0) {
        targetAgentId = recent[0].agentId;
        targetSessionId = recent[0].id;
      }
    }

    await this.commandDispatcher.dispatch(
      'chat',
      {
        employeeId: targetAgentId,
        options: {
          message: input.message,
          oneShot: true,
          disableProcessExit: true,
          suppressAutoIntroduction: input.skipPersist,
          sessionId: targetSessionId,
        },
      },
      { history: [] }
    );

    // The CLI renderer consumes streamed token events directly from EmitService.
    // Returning text here is optional; keep empty to avoid duplicate rendering.
    return '';
  }
}

export class ChatRuntimeV2CliAdapter implements IChatRuntimeV2 {
  private readonly runtime: ChatRuntimeV2;
  private activeAgentId?: string;
  private activeSessionId?: string;

  constructor(
    turnRunner: ICliChatV2TurnRunner,
    loopEngine: ChatLoopEngineV2 = new ChatLoopEngineV2()
  ) {
    this.runtime = new ChatRuntimeV2(
      {
        runPreturnInterceptorsAsync: async () => ({ outcome: 'continue' }),
        runSendTurnAsync: async (
          input: ChatRuntimeV2TurnInput
        ): Promise<ChatRuntimeV2TurnResult> => ({
          text: await turnRunner.runTurnAsync({
            message: input.userMessage,
            skipPersist: input.options.skipPersist,
            agentId: this.activeAgentId,
            sessionId: this.activeSessionId,
          }),
          toolRoundNeeded: false,
        }),
        runPostTurnResolutionAsync: async () => ({ outcome: 'normal_complete' }),
        runHandoffTransitionAsync: async () => ({}),
      },
      loopEngine
    );
  }

  async runAsync(input: Parameters<IChatRuntimeV2['runAsync']>[0]) {
    this.activeAgentId = input.agentId;
    this.activeSessionId = input.sessionId;
    try {
      return await this.runtime.runAsync(input);
    } finally {
      this.activeAgentId = undefined;
      this.activeSessionId = undefined;
    }
  }
}

export function registerCliChatRuntimeV2(container: IServiceContainer): void {
  container.registerScoped(COMMAND_FACTORY_TOKENS.ChatRuntimeV2, (c) => {
    const commandDispatcher = c.resolve(COMMAND_FACTORY_TOKENS.CommandDispatcher);
    const turnRunner = new CliChatV2TurnRunner(c, commandDispatcher);
    return new ChatRuntimeV2CliAdapter(turnRunner);
  });
}
