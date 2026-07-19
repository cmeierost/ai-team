import { inspect } from 'node:util';
import type {
  Agent,
  IAgentManager,
  ICommand,
  ChatMessage,
  ILlmChatMessageParam,
  ILlmService,
  Skill,
  StructuredToolResult,
  ExecutionContext,
  IEmitService,
  ISessionManager,
  ILlmInvokeService,
  IToolDispatchService,
  IToolSchemaService,
  ISendTurnStepService,
} from '@ai-team/core';
import type { WorkflowCallbacks } from '../runtime/hooks.js';
import type { LlmToolDefinition } from '../../tooling/manager/tool-manager.js';
import { ToolIdentity } from '../../tooling/manager/tool-manager.js';
import type { ResolvedPlugins, TurnResult } from '../runtime/pipeline.js';
import type { IChatSkillService } from './chat-skill-service.js';

export interface SendTurnOptions {
  skipPersist?: boolean;
}

/**
 * Runtime dependencies threaded explicitly into send-turn steps.
 * These are NOT on ExecutionContext — they are injected by the runtime.
 */
export interface SendTurnPersistenceDeps {
  sessionManager: ISessionManager;
  agentManager: IAgentManager;
}

export interface SendTurnSkillDeps {
  chatSkillService: IChatSkillService;
}

export interface SendTurnLlmDeps {
  llmService: ILlmService;
  invokeService: ILlmInvokeService;
  toolDispatcher: IToolDispatchService;
  toolSchemaService: IToolSchemaService;
}

export interface SendTurnRuntimeDeps {
  runtimeCallbacks: WorkflowCallbacks;
  emitService: IEmitService;
}

export interface SendTurnDeps {
  persistence: SendTurnPersistenceDeps;
  skills: SendTurnSkillDeps;
  llm: SendTurnLlmDeps;
  runtime: SendTurnRuntimeDeps;
}

export interface SendTurnResolvedSkillsAndTools {
  skills: Skill[];
  teamRoster: Agent[];
  allTools: ICommand[];
  toolDefs: LlmToolDefinition[];
}

export interface SendTurnLlmInvocationResult {
  fullResponse: string;
  structuredResults: StructuredToolResult[];
}

const TITLE_GENERATION_MIN_HUMAN_TURNS = 3;

export class SendTurnStepService implements ISendTurnStepService {
  constructor(
    private readonly sessionManager: ISessionManager,
    private readonly agentManager: IAgentManager,
    private readonly chatSkillService: IChatSkillService,
    private readonly llmService: ILlmService,
    private readonly llmInvokeService: ILlmInvokeService,
    private readonly toolDispatcher: IToolDispatchService,
    private readonly toolSchemaService: IToolSchemaService,
    private readonly runtimeCallbacks: WorkflowCallbacks,
    private readonly emitService: IEmitService
  ) {}

  async ensureTurnStartAsync(): Promise<void> {
    // Signal check removed - handled by withAbortSignal in LlmInvokeService
  }

  async persistUserMessageAsync(
    userMessage: string,
    ctx: ExecutionContext,
    options?: SendTurnOptions
  ): Promise<ChatMessage> {
    const userMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: ctx.agent!.id,
      isHuman: true,
      content: userMessage,
    };

    if (!options?.skipPersist) {
      const generatedTitle = await this.sessionManager.appendMessage(
        ctx.sessionId!,
        userMsg,
        this.shouldEnableTitleGeneration(ctx, true) ? this.llmService : undefined
      );
      if (generatedTitle) {
        this.emitService.emit({
          kind: 'session_title_updated',
          sessionId: ctx.sessionId!,
          title: generatedTitle,
        });
      }
    }

    ctx.history.push(userMsg);
    this.emitService.status('thinking');
    return userMsg;
  }

  async prepareMessagesAsync(
    userMessage: string,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext
  ): Promise<ILlmChatMessageParam[]> {
    const compressed = await plugins.compressor.compress(ctx.history, ctx);
    const messages = await plugins.contextBuilder.build(compressed, ctx);

    for (const enricher of plugins.enrichers) {
      const extra = await enricher.enrich(ctx);
      if (extra) {
        messages.unshift({ role: 'system', content: extra });
      }
    }

    const ragSnippet = await plugins.ragProvider.retrieve(userMessage, ctx);
    if (ragSnippet) {
      messages.push({ role: 'system', content: `## Relevant context\n${ragSnippet}` });
    }

    return messages;
  }

  async resolveSkillsAndToolsAsync(
    userMessage: string,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext
  ): Promise<SendTurnResolvedSkillsAndTools> {
    const resolved = await this.chatSkillService.resolveSkillsForTurnAsync({ userMessage, ctx });
    const skills = resolved.skills;
    const teamRoster = await this.agentManager.getAllAgentsAsync();

    const discoverMcpTools = (plugins.mcpGateway as { discover?: () => Promise<ICommand[]> })
      .discover;
    const [tools, mcpTools] = await Promise.all([
      plugins.toolResolver.resolve(ctx),
      typeof discoverMcpTools === 'function'
        ? discoverMcpTools.call(plugins.mcpGateway)
        : Promise.resolve([] as ICommand[]),
    ]);

    const allowedMcpTools = this.filterDiscoveredToolsForAgent(ctx.agent!, mcpTools);
    const allTools = [...tools, ...allowedMcpTools];

    await plugins.llmSelector.select(ctx);

    const toolDefs = this.buildToolDefinitions(allTools);

    return {
      skills,
      teamRoster,
      allTools,
      toolDefs,
    };
  }

  async invokeTurnLlmAsync(
    messages: ILlmChatMessageParam[],
    resolved: SendTurnResolvedSkillsAndTools,
    ctx: ExecutionContext
  ): Promise<SendTurnLlmInvocationResult> {
    const invoked = await this.llmInvokeService.invokeAsync({
      messages,
      tools: resolved.allTools,
      toolDefs: resolved.toolDefs,
      skills: resolved.skills,
      teamRoster: resolved.teamRoster,
      ctx,
    });

    return {
      fullResponse: invoked.fullResponse,
      structuredResults: invoked.structuredResults,
    };
  }

  async handleLlmFailureAsync(
    error: unknown,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext,
    options?: SendTurnOptions
  ): Promise<TurnResult> {
    if (this.isAbortError(error)) {
      throw error;
    }

    const message = this.toErrorMessage(error);
    process.stderr.write(`\n[LLM error] ${message}\n`);
    this.emitService.status('error', message);

    const persistedContent = this.buildRetryableFailureMessage(message);

    const failedAgentMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: ctx.agent!.id,
      to: 'human',
      content: persistedContent,
      isHuman: false,
      archived: true,
    };

    if (!options?.skipPersist) {
      await this.sessionManager.appendMessage(ctx.sessionId!, failedAgentMsg);
    }

    ctx.history.push(failedAgentMsg);

    const failedTurnResult: TurnResult = { text: persistedContent, done: true };
    await plugins.outputHandler.handle(failedTurnResult, ctx);

    return failedTurnResult;
  }

  async persistAssistantMessageAsync(
    fullResponse: string,
    ctx: ExecutionContext
  ): Promise<{ persistedContent: string; persistedMessage: ChatMessage }> {
    const persistedContent = fullResponse;

    const agentMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: ctx.agent!.id,
      to: 'human',
      content: persistedContent,
      isHuman: false,
    };

    const generatedTitle = await this.sessionManager.appendMessage(
      ctx.sessionId!,
      agentMsg,
      this.shouldEnableTitleGeneration(ctx, false) ? this.llmService : undefined
    );
    ctx.history.push(agentMsg);

    if (generatedTitle) {
      this.emitService.emit({
        kind: 'session_title_updated',
        sessionId: ctx.sessionId!,
        title: generatedTitle,
      });
    }

    await this.agentManager.recordInteractionAsync(ctx.agent!.id);

    return {
      persistedContent,
      persistedMessage: agentMsg,
    };
  }

  async parseTurnResultAsync(
    structuredResults: StructuredToolResult[],
    fullResponse: string,
    persistedContent: string,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext
  ): Promise<TurnResult | null> {
    for (const parser of plugins.turnResultParsers) {
      const override = parser.parse(structuredResults, fullResponse, persistedContent, ctx);
      if (override !== null) {
        return override as TurnResult;
      }
    }

    return null;
  }

  async finalizeTurnResultAsync(
    turnResult: TurnResult,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext
  ): Promise<TurnResult> {
    await plugins.outputHandler.handle(turnResult, ctx);

    return turnResult;
  }

  private buildToolDefinitions(tools: ICommand[]): LlmToolDefinition[] {
    return this.toolSchemaService.buildToolDefinitions(tools);
  }

  private filterDiscoveredToolsForAgent(agent: Agent, discoveredTools: ICommand[]): ICommand[] {
    const allowedSelectors = (agent.tools ?? []).map((selector) => selector.trim()).filter(Boolean);
    if (allowedSelectors.length === 0) {
      return [];
    }

    const deniedSelectors = (agent.disallowedTools ?? [])
      .map((selector) => selector.trim())
      .filter(Boolean);

    return discoveredTools.filter((tool) => {
      if (!tool.metadata.availableIn?.tool) {
        return false;
      }

      if (
        deniedSelectors.some((selector) => ToolIdentity.matchesSelector(selector, tool.metadata))
      ) {
        return false;
      }

      return allowedSelectors.some((selector) =>
        ToolIdentity.matchesSelector(selector, tool.metadata)
      );
    });
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized) {
        return serialized;
      }
    } catch {
      // no-op; fall through to inspect
    }

    return inspect(error, { depth: 1, breakLength: Infinity });
  }

  private buildRetryableFailureMessage(rawMessage: string): string {
    const normalized = rawMessage.toLowerCase();

    if (normalized.includes('timed out') || normalized.includes('timeout')) {
      return "Sorry — I couldn't complete that request in time. Please try again.";
    }

    return 'Sorry — I ran into a temporary issue while processing your request. Please try again.';
  }

  private isAbortError(error: unknown): boolean {
    if (error instanceof Error) {
      return error.name === 'AbortError' || error.message.includes('aborted');
    }
    return false;
  }

  private shouldEnableTitleGeneration(
    ctx: ExecutionContext,
    includePendingUserMessage: boolean
  ): boolean {
    const existingHumanTurns = ctx.history.filter((message) => message.isHuman).length;
    const humanTurnsAfterAppend = includePendingUserMessage
      ? existingHumanTurns + 1
      : existingHumanTurns;
    return humanTurnsAfterAppend >= TITLE_GENERATION_MIN_HUMAN_TURNS;
  }
}
