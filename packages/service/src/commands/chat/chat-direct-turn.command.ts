import { z } from 'zod';
import type {
  Agent,
  ChatMessage,
  CommandResponse,
  ExecutionContext,
  IChatTurnBootstrapResolver,
  ICommand,
  ICommandDescriptor,
  IEmitService,
  ISendTurnStepService,
  ISessionManager,
} from '@ai-team/core';
import type { CommandResponse as ContractCommandResponse } from '@ai-team/api-contracts';
import type { ResolvedPlugins, TurnResult } from '../../workflow/runtime/pipeline.js';
import { SendTurnResolvedSkillsAndTools } from '../../workflow/chat/send-turn-step-service.js';

const chatDirectTurnParamsSchema = z.object({
  agentId: z.string().optional(),
  options: z.object({
    message: z.string().min(1),
    sessionId: z.string().optional(),
    createNewSession: z.boolean().optional(),
  }),
});

type ChatDirectTurnParams = z.infer<typeof chatDirectTurnParamsSchema>;

interface ChatDirectTurnResult {
  text: string;
  agentId: string;
  sessionId: string;
  handoffTargetId?: string;
  handoffTargetSessionId?: string;
  handoffNote?: string;
  handoffTargetWorkflowId?: string;
  handoffWorkflowToolPolicy?: {
    allow?: string[];
    deny?: string[];
    add?: string[];
    remove?: string[];
  };
}

export class ChatDirectTurnCommand implements ICommand<ChatDirectTurnParams, ChatDirectTurnResult> {
  static readonly metadata = {
    key: 'chat-direct-turn' as const,
    description: 'Execute exactly one chat send-turn without invoking ChatRuntime recursively',
    availableIn: { cli: false, chat: false, tool: false },
    group: 'chat',
    parameters: chatDirectTurnParamsSchema,
  } satisfies ICommandDescriptor;

  readonly metadata = ChatDirectTurnCommand.metadata;

  constructor(
    private readonly bootstrapResolver: IChatTurnBootstrapResolver,
    private readonly stepService: ISendTurnStepService<
      ResolvedPlugins,
      SendTurnResolvedSkillsAndTools,
      TurnResult
    >,
    private readonly plugins: ResolvedPlugins,
    private readonly sessionManager: ISessionManager,
    private readonly emitService: IEmitService
  ) {}

  async execute(
    payload: ChatDirectTurnParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<ChatDirectTurnResult>> {
    const bootstrap = await this.bootstrapResolver.resolveAsync(
      {
        agentQuery: payload.agentId,
        sessionId: payload.options.sessionId,
        createNewSession: payload.options.createNewSession,
      },
      ctx
    );

    if (!bootstrap.ok) {
      return { status: 'error', message: bootstrap.message };
    }

    const turnContext = this.toExecutionContext(ctx, bootstrap.sessionId, bootstrap.agent);
    turnContext.history.push(...bootstrap.history);

    const slashHandled = await this.tryHandleSlashCommandAsync(payload.options.message, turnContext);
    if (slashHandled) {
      this.bootstrapResolver.updateCachedRuntimeState(ctx, {
        agentId: turnContext.agent?.id ?? bootstrap.agent.id,
        sessionId: turnContext.sessionId ?? bootstrap.sessionId,
        history: turnContext.history,
        navStack: turnContext.navStack,
      });

      return {
        status: 'ok',
        data: {
          text: slashHandled.responseText,
          agentId: turnContext.agent?.id ?? bootstrap.agent.id,
          sessionId: turnContext.sessionId ?? bootstrap.sessionId,
        },
        message: 'completed',
      };
    }

    await this.stepService.ensureTurnStartAsync();
    await this.stepService.persistUserMessageAsync(payload.options.message, turnContext);

    const messages = await this.stepService.prepareMessagesAsync(
      payload.options.message,
      this.plugins,
      turnContext
    );
    const resolved = await this.stepService.resolveSkillsAndToolsAsync(
      payload.options.message,
      this.plugins,
      turnContext
    );

    try {
      const invocation = await this.stepService.invokeTurnLlmAsync(messages, resolved, turnContext);
      const persisted = await this.stepService.persistAssistantMessageAsync(
        invocation.fullResponse,
        turnContext
      );
      const parsed = await this.stepService.parseTurnResultAsync(
        invocation.structuredResults,
        invocation.fullResponse,
        persisted.persistedContent,
        this.plugins,
        turnContext
      );
      const finalResult = await this.stepService.finalizeTurnResultAsync(
        parsed ?? { text: persisted.persistedContent, done: false },
        this.plugins,
        turnContext
      );

      this.bootstrapResolver.updateCachedRuntimeState(ctx, {
        agentId: turnContext.agent?.id ?? bootstrap.agent.id,
        sessionId: turnContext.sessionId ?? bootstrap.sessionId,
        history: turnContext.history,
        navStack: turnContext.navStack,
      });

      return {
        status: 'ok',
        data: {
          text: finalResult.text,
          agentId: turnContext.agent?.id ?? bootstrap.agent.id,
          sessionId: turnContext.sessionId ?? bootstrap.sessionId,
          handoffTargetId: finalResult.handoffTargetId,
          handoffTargetSessionId: finalResult.handoffTargetSessionId,
          handoffNote: finalResult.handoffNote,
          handoffTargetWorkflowId: finalResult.handoffTargetWorkflowId,
          handoffWorkflowToolPolicy: finalResult.handoffWorkflowToolPolicy,
        },
        message: 'completed',
      };
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || /aborted/i.test(error.message))
      ) {
        throw error;
      }
      const failed = await this.stepService.handleLlmFailureAsync(error, this.plugins, turnContext);
      this.bootstrapResolver.updateCachedRuntimeState(ctx, {
        agentId: turnContext.agent?.id ?? bootstrap.agent.id,
        sessionId: turnContext.sessionId ?? bootstrap.sessionId,
        history: turnContext.history,
        navStack: turnContext.navStack,
      });
      return {
        status: 'ok',
        data: {
          text: failed.text,
          agentId: turnContext.agent?.id ?? bootstrap.agent.id,
          sessionId: turnContext.sessionId ?? bootstrap.sessionId,
          handoffTargetId: failed.handoffTargetId,
          handoffTargetSessionId: failed.handoffTargetSessionId,
          handoffNote: failed.handoffNote,
          handoffTargetWorkflowId: failed.handoffTargetWorkflowId,
          handoffWorkflowToolPolicy: failed.handoffWorkflowToolPolicy,
        },
        message: 'completed',
      };
    }
  }

  private toExecutionContext(
    base: ExecutionContext,
    sessionId: string,
    agent: Agent
  ): ExecutionContext {
    return {
      history: [],
      sessionId,
      agent,
      ...(base.signal ? { signal: base.signal } : {}),
      ...(base.invocationSurface ? { invocationSurface: base.invocationSurface } : {}),
      ...(base.calledByHuman !== undefined ? { calledByHuman: base.calledByHuman } : {}),
      ...(base.workflowId ? { workflowId: base.workflowId } : {}),
      ...(base.workflowInstanceId ? { workflowInstanceId: base.workflowInstanceId } : {}),
      ...(base.stepId ? { stepId: base.stepId } : {}),
      ...(base.workflowState ? { workflowState: base.workflowState } : {}),
      ...(base.navStack ? { navStack: [...base.navStack] } : {}),
    };
  }

  private async tryHandleSlashCommandAsync(
    userMessage: string,
    ctx: ExecutionContext
  ): Promise<{ responseText: string } | null> {
    const parsed = this.parseSlashInvocation(userMessage);
    if (!parsed) {
      return null;
    }

    const resolvedCommand = this.resolveSlashCommand(parsed.commandToken);
    const commandKey = resolvedCommand?.canonicalKey ?? parsed.commandToken;
    const slashToolName = `slash:${parsed.commandToken}`;

    const dispatched = await this.plugins.commandDispatcher.dispatch(
      commandKey,
      parsed.rawArgs,
      ctx
    );
    const commandResponse = this.toCoreCommandResponse(dispatched);

    const responseText = this.toSlashResponseText(commandResponse);

    const slashMessage: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: ctx.agent!.id,
      isHuman: true,
      hiddenFromLlm: true,
      content: parsed.rawInput,
      tool_calls: [
        {
          tool: slashToolName,
          params: {
            commandKey,
            commandToken: parsed.commandToken,
            rawArgs: parsed.rawArgs,
            rawInput: parsed.rawInput,
            invokedBy: 'user',
          },
          result: commandResponse,
          resultLlm: responseText,
        },
      ],
    };

    await this.sessionManager.appendMessage(ctx.sessionId!, slashMessage);
    ctx.history.push(slashMessage);

    this.emitService.toolEvent(
      slashToolName,
      undefined,
      commandResponse.status === 'ok' ? 'result' : 'error',
      responseText,
      undefined,
      {
        toolName: slashToolName,
        outcome: commandResponse.status === 'ok' ? 'result' : 'error',
        commandResponse,
        resultLlm: responseText,
      }
    );

    return { responseText };
  }

  private parseSlashInvocation(
    userMessage: string
  ): { commandToken: string; rawArgs: string; rawInput: string } | null {
    const rawInput = userMessage.trim();
    if (!rawInput.startsWith('/')) {
      return null;
    }

    const [rawCommandToken, ...rest] = rawInput.slice(1).split(/\s+/);
    const commandToken = (rawCommandToken ?? '').trim().toLowerCase();
    if (!commandToken) {
      return null;
    }

    return {
      commandToken,
      rawArgs: rest.join(' '),
      rawInput,
    };
  }

  private resolveSlashCommand(
    commandToken: string
  ): { canonicalKey: string; descriptorKey: string } | undefined {
    const direct = this.plugins.commandDispatcher.getCommand(commandToken);
    if (direct) {
      return {
        canonicalKey: direct.group ? `${direct.group}-${direct.key}` : direct.key,
        descriptorKey: direct.key,
      };
    }

    const matched = this.plugins.commandDispatcher
      .getCommands({ chat: true })
      .find(
        (descriptor) =>
          descriptor.key.toLowerCase() === commandToken ||
          (descriptor.aliases ?? []).some((alias) => alias.toLowerCase() === commandToken)
      );

    if (!matched) {
      return undefined;
    }

    return {
      canonicalKey: matched.group ? `${matched.group}-${matched.key}` : matched.key,
      descriptorKey: matched.key,
    };
  }

  private toSlashResponseText(response: CommandResponse<unknown>): string {
    if (typeof response.message === 'string' && response.message.trim().length > 0) {
      return response.message;
    }

    if (typeof response.data === 'string') {
      return response.data;
    }

    if (response.data !== undefined) {
      try {
        return JSON.stringify(response.data, null, 2);
      } catch {
        return '[unserializable command result]';
      }
    }

    return response.status === 'ok' ? 'Command executed.' : 'Command failed.';
  }

  private toCoreCommandResponse(
    response: ContractCommandResponse<unknown>
  ): CommandResponse<unknown> {
    const error = response.error
      ? {
          code: response.error.code,
          message:
            typeof response.message === 'string' && response.message.trim().length > 0
              ? response.message
              : 'Command failed',
          details: response.error.details,
        }
      : undefined;

    return {
      status: response.status,
      message: response.message,
      ...(response.data !== undefined ? { data: response.data } : {}),
      ...(response.saveable !== undefined ? { saveable: response.saveable } : {}),
      ...(error ? { error } : {}),
    };
  }
}
