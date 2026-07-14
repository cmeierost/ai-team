import type {
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
} from '@ai-team/core';
import type { ILlmChatMessageParam, StructuredToolResult } from '@ai-team/core';
import type { TurnResult, ResolvedPlugins } from '../runtime/pipeline.js';
import type {
  SendTurnLlmInvocationResult,
  SendTurnOptions,
  SendTurnResolvedSkillsAndTools,
  SendTurnStepService,
} from './send-turn-step-service.js';

export type SendTurnStepName =
  | 'ensureTurnStart'
  | 'persistUserMessage'
  | 'prepareMessages'
  | 'resolveSkillsTools'
  | 'invokeLlm'
  | 'handleLlmFailure'
  | 'persistAssistantMessage'
  | 'parseResult'
  | 'finalizeResult';

export interface SendTurnStepCommandInputMap {
  ensureTurnStart: Record<string, never>;
  persistUserMessage: {
    userMessage: string;
    ctx: ExecutionContext;
    options?: SendTurnOptions;
  };
  prepareMessages: {
    userMessage: string;
    plugins: ResolvedPlugins;
    ctx: ExecutionContext;
  };
  resolveSkillsTools: {
    userMessage: string;
    plugins: ResolvedPlugins;
    ctx: ExecutionContext;
  };
  invokeLlm: {
    messages: ILlmChatMessageParam[];
    resolved: SendTurnResolvedSkillsAndTools;
    ctx: ExecutionContext;
  };
  handleLlmFailure: {
    invocationError: unknown;
    plugins: ResolvedPlugins;
    ctx: ExecutionContext;
    options?: SendTurnOptions;
  };
  persistAssistantMessage: {
    fullResponse: string;
    ctx: ExecutionContext;
  };
  parseResult: {
    structuredResults: StructuredToolResult[];
    fullResponse: string;
    persistedContent: string;
    plugins: ResolvedPlugins;
    ctx: ExecutionContext;
  };
  finalizeResult: {
    parsedTurnResult: TurnResult | null;
    persistedContent: string;
    plugins: ResolvedPlugins;
    ctx: ExecutionContext;
  };
}

export interface SendTurnStepCommandOutputMap {
  ensureTurnStart: void;
  persistUserMessage: void;
  prepareMessages: ILlmChatMessageParam[];
  resolveSkillsTools: SendTurnResolvedSkillsAndTools;
  invokeLlm: SendTurnLlmInvocationResult;
  handleLlmFailure: TurnResult;
  persistAssistantMessage: { persistedContent: string };
  parseResult: TurnResult | null;
  finalizeResult: TurnResult;
}

export type SendTurnStepCommandMap = {
  [K in SendTurnStepName]: ICommand<
    SendTurnStepCommandInputMap[K],
    SendTurnStepCommandOutputMap[K]
  >;
};

export type SendTurnStepResolver = (
  step: SendTurnStepName
) => SendTurnStepCommandMap[SendTurnStepName] | undefined;

export function createSendTurnStepCommand<TInput, TOutput>(
  step: SendTurnStepName,
  executeAsync: (input: TInput) => Promise<TOutput>
): ICommand<TInput, TOutput> {
  const metadata: ICommandDescriptor<TInput> = {
    key: `send-turn-step:${step}`,
    description: `Internal send-turn step command: ${step}`,
    availableIn: { cli: false, chat: false, tool: false },
  };

  return {
    metadata,
    execute: async (params: TInput, _ctx: ExecutionContext): Promise<CommandResponse<TOutput>> => {
      const data = await executeAsync(params);
      return { status: 'ok', data };
    },
  };
}

export function createSendTurnStepCommands(
  stepService: SendTurnStepService
): SendTurnStepCommandMap {
  return {
    ensureTurnStart: createSendTurnStepCommand('ensureTurnStart', async () => {
      await stepService.ensureTurnStartAsync();
    }),
    persistUserMessage: createSendTurnStepCommand('persistUserMessage', async (input) => {
      await stepService.persistUserMessageAsync(input.userMessage, input.ctx, input.options);
    }),
    prepareMessages: createSendTurnStepCommand('prepareMessages', async (input) =>
      stepService.prepareMessagesAsync(input.userMessage, input.plugins, input.ctx)
    ),
    resolveSkillsTools: createSendTurnStepCommand('resolveSkillsTools', async (input) =>
      stepService.resolveSkillsAndToolsAsync(input.userMessage, input.plugins, input.ctx)
    ),
    invokeLlm: createSendTurnStepCommand('invokeLlm', async (input) =>
      stepService.invokeTurnLlmAsync(input.messages, input.resolved, input.ctx)
    ),
    handleLlmFailure: createSendTurnStepCommand('handleLlmFailure', async (input) =>
      stepService.handleLlmFailureAsync(
        input.invocationError,
        input.plugins,
        input.ctx,
        input.options
      )
    ),
    persistAssistantMessage: createSendTurnStepCommand('persistAssistantMessage', async (input) => {
      const persisted = await stepService.persistAssistantMessageAsync(
        input.fullResponse,
        input.ctx
      );
      return { persistedContent: persisted.persistedContent };
    }),
    parseResult: createSendTurnStepCommand('parseResult', async (input) =>
      stepService.parseTurnResultAsync(
        input.structuredResults,
        input.fullResponse,
        input.persistedContent,
        input.plugins,
        input.ctx
      )
    ),
    finalizeResult: createSendTurnStepCommand('finalizeResult', async (input) => {
      const turnResult: TurnResult = input.parsedTurnResult ?? {
        text: input.persistedContent,
        done: false,
      };

      return stepService.finalizeTurnResultAsync(turnResult, input.plugins, input.ctx);
    }),
  };
}
