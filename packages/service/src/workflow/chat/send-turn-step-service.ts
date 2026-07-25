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
  IDeveloperIdentityService,
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
  /** Keep an automatic continuation failure visible in the receiving agent's transcript. */
  archiveFailure?: boolean;
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
  metrics: NonNullable<ChatMessage['llmMetadata']>;
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
    private readonly emitService: IEmitService,
    private readonly developerIdentityService: Pick<IDeveloperIdentityService, 'getUserName'>
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

    messages.unshift({
      role: 'system',
      content: this.buildConversationParticipantsPrompt(),
    });

    const ragSnippet = await plugins.ragProvider.retrieve(userMessage, ctx);
    if (ragSnippet) {
      messages.push({ role: 'system', content: `## Relevant context\n${ragSnippet}` });
    }

    return messages;
  }

  private buildConversationParticipantsPrompt(): string {
    const developerName = this.developerIdentityService.getUserName()?.trim() || 'the developer';
    const developerFirstName =
      developerName === 'the developer' ? developerName : developerName.split(/\s+/)[0];

    return [
      '## Conversation Participants',
      `You are speaking directly with ${developerName}, the human developer using ai-team.`,
      `Ordinary messages with the user role are authored by ${developerName}, who is your current conversational counterpart.`,
      'The explicit exception is an "[Internal handoff —" message: the runtime injects it with the user role so you will respond, but its text is a colleague-to-colleague briefing.',
      `When addressing the developer by name, usually use their first name, ${developerFirstName}. Use ${developerName} only when the full name is genuinely useful or a more formal tone is appropriate.`,
      'You may also address the developer naturally as "you". Do not address the developer as another AI team member.',
      'People named in your role, reporting line, team roster, handoff context, or tool output are other team members unless they are explicitly identified as the human developer.',
      `When the latest input is an internal handoff, address ${developerName} directly, not the sending colleague. Briefly acknowledge only the useful context, translate third-person wording such as "${developerFirstName} wants" into "you want", and take the requested next step. Do not quote the briefing, ask the developer to repeat known context, or answer the sender. If essential information is missing, ask the developer one focused question.`,
      'An internal handoff may establish a return path, but its existence is not an instruction to return immediately. Use session_return only after the developer clearly asks to return/report back or confirms the delegated work is finished and they want to continue with the parent. If their intent is ambiguous, ask one concise question. Do not return merely because you answered the current question.',
      'If the developer asks to switch to or involve a different agent—or the work clearly belongs to another agent—call com_handoff instead of merely describing a transfer. Do not use com_handoff to return to the parent workflow. For a new handoff, write a briefingNote that states the developer’s objective, relevant decisions or constraints, the receiving agent’s responsibility and expected first action, and any requested return or follow-up path.',
    ].join('\n');
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

    const toolDefs = this.buildToolDefinitions(allTools, plugins);

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
      metrics: invoked.metrics,
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

    const persistedContent = this.buildRetryableFailureMessage(message);
    this.emitService.status('error', `${persistedContent}\n\nDetails: ${message}`);

    const failedAgentMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: ctx.agent!.id,
      to: 'human',
      content: persistedContent,
      isHuman: false,
      archived: options?.archiveFailure ?? true,
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
    ctx: ExecutionContext,
    llmMetadata?: ChatMessage['llmMetadata']
  ): Promise<{ persistedContent: string; persistedMessage: ChatMessage }> {
    const persistedContent = fullResponse;

    const agentMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: ctx.agent!.id,
      to: 'human',
      content: persistedContent,
      isHuman: false,
      llmMetadata,
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

  private buildToolDefinitions(tools: ICommand[], plugins: ResolvedPlugins): LlmToolDefinition[] {
    const commandToolDefs = this.toolSchemaService.buildToolDefinitions(tools);
    const commandNames = new Set(commandToolDefs.map((tool) => tool.name));
    const workflowDescriptors = plugins.commandDispatcher
      .getCommands({ tool: true })
      .filter((descriptor) => descriptor.group === 'workflow' && descriptor.key !== 'list')
      .map((descriptor) => ({
        key: descriptor.key,
        group: descriptor.group,
        description: descriptor.description,
      }));
    const workflowToolDefs = this.toolSchemaService
      .buildToolDefinitionsFromDescriptors(workflowDescriptors)
      .filter((tool) => !commandNames.has(tool.name));
    return [...commandToolDefs, ...workflowToolDefs];
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
