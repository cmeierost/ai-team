import type { CommandResponse } from '@ai-team/api-contracts';
import type { ChatMessage, ExecutionContext, IServiceContainer } from '@ai-team/core';
import { COMMAND_FACTORY_TOKENS } from '../../types.js';

interface WorkflowPhaseInput {
  agentId: string;
  systemPrompt: string;
  exitWords: string[];
  toolAllowlist?: string[];
  openingMessage?: string;
}

interface CommandDispatcherLike {
  dispatch(key: string, params: unknown, ctx: ExecutionContext): Promise<CommandResponse<unknown>>;
}

interface SessionManagerLike {
  getLatestSession(agentId: string): Promise<{ id: string } | null>;
  appendMessage(sessionId: string, message: ChatMessage): Promise<string | null>;
  getSessionMessages(sessionId: string): Promise<ChatMessage[]>;
}

interface QuestionServiceLike {
  input(request: { message: string; validate?: (value: string) => true | string }): Promise<string>;
}

class WorkflowPhase {
  private readonly dispatcher: CommandDispatcherLike;
  private readonly sessionManager: SessionManagerLike;
  private readonly questionService: QuestionServiceLike;

  constructor(container: IServiceContainer) {
    this.dispatcher = container.resolve<CommandDispatcherLike>(
      COMMAND_FACTORY_TOKENS.CommandDispatcher
    );
    this.sessionManager = container.resolve<SessionManagerLike>(COMMAND_FACTORY_TOKENS.SessionManager);
    this.questionService = container.resolve<QuestionServiceLike>(
      COMMAND_FACTORY_TOKENS.QuestionService
    );
  }

  async runAsync(
    input: WorkflowPhaseInput,
    executionContext: ExecutionContext
  ): Promise<ChatMessage[]> {
    const runCtx: ExecutionContext = {
      history: [],
      signal: executionContext.signal,
      invocationSurface: executionContext.invocationSurface,
      workflowState: executionContext.workflowState,
    };

    await this.dispatchOrThrow(
      'chat-chat-startup',
      {
        employeeId: input.agentId,
        options: {
          createNewSession: true,
        },
      },
      runCtx
    );

    const session = await this.sessionManager.getLatestSession(input.agentId);
    if (!session) {
      throw new Error(`No active session found for phase agent '${input.agentId}'.`);
    }

    if (input.openingMessage?.trim()) {
      await this.sessionManager.appendMessage(session.id, {
        timestamp: new Date().toISOString(),
        from: input.agentId,
        to: 'human',
        content: input.openingMessage.trim(),
        importance: 'low',
      });
    }

    const exitWords = new Set(
      input.exitWords.map((word) => word.trim().toLowerCase()).filter(Boolean)
    );
    let phasePromptInjected = false;

    while (true) {
      const userInput = await this.questionService.input({
        message: 'You: ',
        validate: (value: string) => value.trim().length > 0 || 'Message cannot be empty',
      });

      if (exitWords.has(userInput.trim().toLowerCase())) {
        break;
      }

      const message = phasePromptInjected ? userInput : this.composePhasePreface(input, userInput);
      phasePromptInjected = true;

      await this.dispatchOrThrow(
        'chat-chat-turn',
        {
          employeeId: input.agentId,
          options: {
            message,
            disableProcessExit: true,
          },
        },
        runCtx
      );
    }

    return this.sessionManager.getSessionMessages(session.id);
  }

  private composePhasePreface(input: WorkflowPhaseInput, message: string): string {
    const allowlistHint = input.toolAllowlist?.length
      ? `Allowed tools for this phase: ${input.toolAllowlist.join(', ')}`
      : 'Use your default tool access for this phase.';

    return [
      '[WORKFLOW PHASE CONTEXT]',
      input.systemPrompt.trim(),
      allowlistHint,
      '[END WORKFLOW PHASE CONTEXT]',
      message,
    ].join('\n\n');
  }

  private async dispatchOrThrow(
    key: string,
    payload: unknown,
    ctx: ExecutionContext
  ): Promise<void> {
    const result = await this.dispatcher.dispatch(key, payload, ctx);
    if (result.status === 'error') {
      throw new Error(result.message || `Command '${key}' failed`);
    }
  }
}

export async function runWorkflowPhaseAsync(
  input: WorkflowPhaseInput,
  executionContext: ExecutionContext,
  container: IServiceContainer
): Promise<ChatMessage[]> {
  const phase = new WorkflowPhase(container);
  return phase.runAsync(input, executionContext);
}
