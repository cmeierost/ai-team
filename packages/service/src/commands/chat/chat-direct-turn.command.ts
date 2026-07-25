import { z } from 'zod';
import { randomUUID } from 'node:crypto';
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
import { HANDOFF_AUTO_REACT_MESSAGE } from '../../workflow/chat/handoff-auto-react.js';
import type { WorkflowInteractionRouter } from '../../workflow/workflow-interaction-router.js';
import {
  parseSlashInvocation,
  resolveSlashInvocation,
} from '../../command-dispatcher/slash-invocation.js';

// These commands intentionally detach from the active workflow. A newly
// created session has no delegated context and must not receive an automatic
// continuation turn from the workflow that happened to launch it.
const DETACHED_SESSION_COMMAND_KEYS = new Set(['session-new']);

const chatDirectTurnParamsSchema = z.object({
  agentId: z.string().optional(),
  options: z.object({
    message: z.string().min(1),
    messageOrigin: z.enum(['developer', 'internal']).optional(),
    sessionId: z.string().optional(),
    createNewSession: z.boolean().optional(),
    workflowSystemPrompt: z.string().optional(),
    workflowToolAllowlist: z.array(z.string()).optional(),
    skipWorkflowInteractionRouting: z.boolean().optional(),
  }),
});

type ChatDirectTurnParams = z.infer<typeof chatDirectTurnParamsSchema>;

interface ChatDirectTurnResult {
  text: string;
  agentId: string;
  sessionId: string;
  followUpMessage?: string;
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
  sourceToolCallId?: string;
  sourceSessionId?: string;
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
    private readonly emitService: IEmitService,
    private readonly workflowInteractions?: Pick<
      WorkflowInteractionRouter,
      'resolveActiveInteraction' | 'dispatchChatTurn'
    >
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
    turnContext.history.push(...bootstrap.sessionHistory);
    const isInternal = payload.options.messageOrigin === 'internal';
    const shouldRouteThroughWorkflowActor = !payload.options.skipWorkflowInteractionRouting;
    const slashHandled = isInternal
      ? null
      : await this.tryHandleSlashCommandAsync(payload.options.message, turnContext);
    if (slashHandled) {
      // Detached navigation must not rewrite the workflow's cached chat
      // cursor. The session_switched event and returned session ID update the
      // interactive surface independently.
      if (!DETACHED_SESSION_COMMAND_KEYS.has(slashHandled.commandKey)) {
        this.bootstrapResolver.updateCachedRuntimeState(ctx, {
          agentId: turnContext.agent?.id ?? bootstrap.agent.id,
          sessionId: turnContext.sessionId ?? bootstrap.sessionId,
          history: turnContext.history,
          navStack: turnContext.navStack,
        });
      }

      return {
        status: 'ok',
        data: {
          text: slashHandled.responseText,
          agentId: turnContext.agent?.id ?? bootstrap.agent.id,
          sessionId: turnContext.sessionId ?? bootstrap.sessionId,
          ...(slashHandled.followUpMessage
            ? { followUpMessage: slashHandled.followUpMessage }
            : {}),
        },
        message: 'completed',
      };
    }

    const activeInteraction =
      shouldRouteThroughWorkflowActor && bootstrap.sessionId
        ? await this.workflowInteractions?.resolveActiveInteraction(bootstrap.sessionId)
        : null;
    if (activeInteraction) {
      const dispatchRoutedTurn = async (
        interaction: { sessionId: string; cursor: string }
      ): Promise<{ routed: { assistantMessage?: string } | null; sessionId: string }> => {
        const sessionId = interaction.sessionId || bootstrap.sessionId;
        const routed = await this.workflowInteractions?.dispatchChatTurn(
          sessionId,
          payload.options.message,
          interaction.cursor
        ) ?? null;
        return { routed, sessionId };
      };
      let routedTurn: {
        routed: { assistantMessage?: string } | null;
        sessionId: string;
      };
      try {
        routedTurn = await dispatchRoutedTurn(activeInteraction);
      } catch (error) {
        if (!this.isCursorMismatchError(error)) {
          throw error;
        }
        const refreshed = await this.workflowInteractions?.resolveActiveInteraction(bootstrap.sessionId);
        if (!refreshed) {
          throw error;
        }
        routedTurn = await dispatchRoutedTurn(refreshed);
      }

      const history = await this.sessionManager.getSessionMessages(routedTurn.sessionId);
      this.bootstrapResolver.updateCachedRuntimeState(ctx, {
        agentId: turnContext.agent?.id ?? bootstrap.agent.id,
        sessionId: routedTurn.sessionId,
        history,
        navStack: turnContext.navStack,
      });

      return {
        status: 'ok',
        data: {
          text: routedTurn.routed?.assistantMessage ?? '',
          agentId: turnContext.agent?.id ?? bootstrap.agent.id,
          sessionId: routedTurn.sessionId,
        },
        message: 'completed',
      };
    }

    await this.stepService.ensureTurnStartAsync();
    if (!isInternal) {
      await this.stepService.persistUserMessageAsync(payload.options.message, turnContext);
    }

    const messages = await this.stepService.prepareMessagesAsync(
      payload.options.message,
      this.plugins,
      turnContext
    );
    if (payload.options.workflowSystemPrompt?.trim()) {
      messages.unshift({
        role: 'system',
        content: payload.options.workflowSystemPrompt.trim(),
      });
    }
    let resolved = await this.stepService.resolveSkillsAndToolsAsync(
      payload.options.message,
      this.plugins,
      turnContext
    );
    if (payload.options.workflowToolAllowlist) {
      const allowed = new Set(payload.options.workflowToolAllowlist);
      resolved = {
        ...resolved,
        toolDefs: resolved.toolDefs.filter((tool) => allowed.has(tool.name)),
      };
    }

    try {
      const sessionBeforeLlm = turnContext.sessionId;
      let invocation;
      try {
        invocation = await this.stepService.invokeTurnLlmAsync(messages, resolved, turnContext);
      } catch (error) {
        // A handoff's receiving turn is automatic. Retry one empty provider
        // response so a transient failure does not leave the developer with a
        // handoff card but no response from the receiving agent.
        if (!isInternal || !this.isEmptyLlmResponse(error)) {
          throw error;
        }
        invocation = await this.stepService.invokeTurnLlmAsync(messages, resolved, turnContext);
      }
      if (turnContext.sessionId !== sessionBeforeLlm) {
        this.bootstrapResolver.updateCachedRuntimeState(ctx, {
          agentId: turnContext.agent?.id ?? bootstrap.agent.id,
          sessionId: turnContext.sessionId ?? bootstrap.sessionId,
          history: turnContext.history,
          navStack: turnContext.navStack,
        });
        return {
          status: 'ok',
          data: {
            text: '',
            agentId: turnContext.agent?.id ?? bootstrap.agent.id,
            sessionId: turnContext.sessionId ?? bootstrap.sessionId,
            followUpMessage: HANDOFF_AUTO_REACT_MESSAGE,
          },
          message: 'completed',
        };
      }

      // A model handoff is a transition request, not a visible source-agent
      // reply. Parse it before persisting streamed text so phrases such as
      // "I'll transfer you" never appear as if the target agent wrote them.
      const handoff = await this.stepService.parseTurnResultAsync(
        invocation.structuredResults,
        invocation.fullResponse,
        '',
        this.plugins,
        turnContext
      );
      if (handoff?.handedOff) {
        const finalResult = await this.stepService.finalizeTurnResultAsync(
          handoff,
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
            sourceToolCallId: finalResult.sourceToolCallId,
            sourceSessionId: finalResult.sourceSessionId,
          },
          message: 'completed',
        };
      }

      const persisted = invocation.metrics
        ? await this.stepService.persistAssistantMessageAsync(
            invocation.fullResponse,
            turnContext,
            invocation.metrics
          )
        : await this.stepService.persistAssistantMessageAsync(invocation.fullResponse, turnContext);
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
          sourceToolCallId: finalResult.sourceToolCallId,
          sourceSessionId: finalResult.sourceSessionId,
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
      const failed = await this.stepService.handleLlmFailureAsync(
        error,
        this.plugins,
        turnContext,
        isInternal ? { archiveFailure: false } : undefined
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
          text: failed.text,
          agentId: turnContext.agent?.id ?? bootstrap.agent.id,
          sessionId: turnContext.sessionId ?? bootstrap.sessionId,
          handoffTargetId: failed.handoffTargetId,
          handoffTargetSessionId: failed.handoffTargetSessionId,
          handoffNote: failed.handoffNote,
          handoffTargetWorkflowId: failed.handoffTargetWorkflowId,
          handoffWorkflowToolPolicy: failed.handoffWorkflowToolPolicy,
          sourceToolCallId: failed.sourceToolCallId,
          sourceSessionId: failed.sourceSessionId,
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
      ...(base.workflowReturn ? { workflowReturn: base.workflowReturn } : {}),
      ...(base.workflowStack ? { workflowStack: [...base.workflowStack] } : {}),
      ...(base.workflowLastResult !== undefined
        ? { workflowLastResult: base.workflowLastResult }
        : {}),
      ...(base.workflowState ? { workflowState: base.workflowState } : {}),
      ...(base.navStack ? { navStack: [...base.navStack] } : {}),
    };
  }

  private isEmptyLlmResponse(error: unknown): boolean {
    return error instanceof Error && /LLM returned an empty response/i.test(error.message);
  }

  private isCursorMismatchError(error: unknown): boolean {
    return error instanceof Error && /interaction cursor mismatch/i.test(error.message);
  }

  private async tryHandleSlashCommandAsync(
    userMessage: string,
    ctx: ExecutionContext
  ): Promise<{ responseText: string; commandKey: string; followUpMessage?: string } | null> {
    const rawInvocation = parseSlashInvocation(userMessage);
    if (!rawInvocation) {
      return null;
    }
    const sessionBeforeSlash = ctx.sessionId;
    // Navigation commands may mutate ctx.sessionId while executing. The tool
    // request and completion still belong to the session where the command
    // was entered, so retain this correlation key for split persistence.
    const toolHistorySessionId = sessionBeforeSlash;
    const parsed = resolveSlashInvocation(
      userMessage,
      this.plugins.commandDispatcher.getCommands({ chat: true })
    );

    const commandKey = parsed?.commandKey ?? rawInvocation.commandToken;
    const slashToolName = `slash:${parsed?.descriptor.key ?? rawInvocation.commandToken}`;
    const slashCallId = randomUUID();
    const invocationRequest = {
      commandKey,
      group: parsed?.descriptor.group,
      key: parsed?.descriptor.key,
      commandToken: parsed?.commandToken ?? rawInvocation.commandToken,
      rawArgs: parsed?.rawArgs ?? rawInvocation.rawArgs,
      rawInput: parsed?.rawInput ?? rawInvocation.rawInput,
      invokedBy: 'user',
    };
    const requestedAt = new Date().toISOString();
    const splitToolHistory =
      typeof this.sessionManager.appendToolCallRequest === 'function' &&
      typeof this.sessionManager.appendToolCallResult === 'function';

    if (splitToolHistory) {
      await this.sessionManager.appendToolCallRequest!(toolHistorySessionId!, {
        timestamp: requestedAt,
        from: 'human',
        to: ctx.agent!.id,
        isHuman: true,
        hiddenFromLlm: true,
        content: rawInvocation.rawInput,
        tool_calls: [
          {
            callId: slashCallId,
            tool: slashToolName,
            params: invocationRequest,
            requestedAt,
          },
        ],
      });
    }
    let commandResponse: CommandResponse<unknown>;
    if (!parsed) {
      commandResponse = {
        status: 'error',
        message: `Unknown chat command: /${rawInvocation.commandToken}`,
      };
    } else {
      const previousInvocationSurface = ctx.invocationSurface;
      const previousCalledByHuman = ctx.calledByHuman;
      const previousCallerType = ctx.callerType;
      const previousCommandInvocation = ctx.commandInvocation;
      ctx.invocationSurface = 'slash';
      ctx.calledByHuman = true;
      ctx.callerType = 'human';
      ctx.commandInvocation = {
        callId: slashCallId,
        toolName: slashToolName,
      };
      try {
        commandResponse = this.toCoreCommandResponse(
          await this.plugins.commandDispatcher.dispatch(commandKey, parsed.rawArgs, ctx)
        );
      } finally {
        ctx.invocationSurface = previousInvocationSurface;
        ctx.calledByHuman = previousCalledByHuman;
        ctx.callerType = previousCallerType;
        ctx.commandInvocation = previousCommandInvocation;
      }
    }

    const responseText = this.toSlashResponseText(commandResponse);

    const slashMessage: ChatMessage = {
      timestamp: requestedAt,
      from: 'human',
      to: ctx.agent!.id,
      isHuman: true,
      hiddenFromLlm: true,
      content: rawInvocation.rawInput,
      tool_calls: [
        {
          callId: slashCallId,
          tool: slashToolName,
          params: invocationRequest,
          requestedAt,
          result: commandResponse,
          resultLlm: responseText,
        },
      ],
    };

    if (splitToolHistory) {
      const resultPhase = commandResponse.status === 'ok' ? 'result' : 'error';
      await this.sessionManager.appendToolCallResult!(
        toolHistorySessionId!,
        slashCallId,
        commandResponse,
        responseText,
        resultPhase,
        new Date().toISOString()
      );
    } else {
      await this.sessionManager.appendMessage(ctx.sessionId!, slashMessage);
    }
    ctx.history.push(slashMessage);

    const descriptor = parsed?.descriptor;

    this.emitService.toolEvent(
      slashToolName,
      slashCallId,
      commandResponse.status === 'ok' ? 'result' : 'error',
      responseText,
      undefined,
      {
        toolName: slashToolName,
        outcome: commandResponse.status === 'ok' ? 'result' : 'error',
        commandGroup: descriptor?.group,
        commandKey: descriptor?.key,
        request: invocationRequest,
        commandResponse,
        resultLlm: responseText,
      }
    );

    const sessionChanged = ctx.sessionId !== sessionBeforeSlash;
    return {
      responseText,
      commandKey,
      ...(sessionChanged && !DETACHED_SESSION_COMMAND_KEYS.has(commandKey)
        ? { followUpMessage: HANDOFF_AUTO_REACT_MESSAGE }
        : {}),
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
