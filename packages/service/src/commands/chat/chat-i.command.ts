import { z } from 'zod';
import ora from 'ora';
import type {
  Agent,
  ChatMessage,
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  IServiceContainer,
  IAgentManager,
  ILlmService,
  IMarkdownSectionService,
  ISkillManager,
  TeamConfig,
} from '@ai-team/core';
import type { ChatOptions, WorkflowStateSnapshot } from '@ai-team/api-contracts';
import { SessionManager } from '../../session-manager.js';
import { ChatOrchestrator } from '../../orchestrator/chat-orchestrator.js';
import { tryIntroduceUser as tryIntroduceUserNew } from '../../orchestrator/introduction.js';
import type { ResolvedPlugins } from '../../orchestrator/pipeline.js';
import { type IEmitService } from '../../orchestrator/services/emit-service.js';
import { NoOpCompressor } from '../../orchestrator/defaults/context-compressor.js';
import { DefaultContextBuilder } from '../../orchestrator/defaults/context-builder.js';
import {
  WorkspaceOverviewEnricher,
  TeamRosterEnricher,
} from '../../orchestrator/defaults/context-enrichers.js';
import { NoOpRagProvider } from '../../orchestrator/defaults/rag-provider.js';
import { DefaultToolResolver } from '../../orchestrator/defaults/tool-resolver.js';
import { WorkflowToolResolver } from '../../orchestrator/defaults/workflow-tool-resolver.js';
import { NoOpMcpGateway } from '../../orchestrator/defaults/mcp-gateway.js';
import { DefaultLlmSelector } from '../../orchestrator/defaults/llm-selector.js';
import { DefaultOutputHandler } from '../../orchestrator/defaults/output-handler.js';
import { buildDefaultHookPlugins } from '../../orchestrator/defaults/hook-plugins.js';
import { buildDefaultTurnResultParsers } from '../../orchestrator/defaults/turn-result-parsers.js';
import { createCommandDispatcher } from '../../command-dispatcher.js';
import { ToolDispatcher } from '../../orchestrator/tool-dispatch.js';
import { HandoffOrchestrator } from '../../orchestrator/handoff.js';
import type { IQuestionService } from '../../questions/question-service.js';
import { WorkflowIntentProvider } from '../../tools/workflow-intent-provider.js';
import { buildDynamicSlashCatalog } from '../../orchestrator/dynamic-slash/catalog.js';
import { readDynamicSlashCatalogConfig } from '../../orchestrator/dynamic-slash/config.js';
import type { ChatRuntimeHooks } from '../../orchestrator/hooks.js';
import { withAbortSignal, isAbortError, throwIfAborted } from '../../utils/async-utils.js';
import { withTimeout } from '../../utils/with-timeout.js';
import { formatUserPrompt } from '../../utils/agent-selection.js';
import {
  ChatInfoService,
  type IChatInfoService,
} from '../../orchestrator/services/chat-info-service.js';
import {
  ChatPreflightService,
  type IChatPreflightService,
} from '../../orchestrator/chat-preflight-service.js';
import { InfoChatCommand } from '../agents/info.command.js';
import { ResolveChatSessionCommand } from './resolve-chat-session.command.js';
import { LoadSessionMessagesCommand } from './load-session-messages.command.js';
import { runChatSessionStartupWorkflow } from './chat-session-startup.workflow.js';
import { COMMAND_FACTORY_TOKENS } from '../../types.js';
import { setServiceContainer } from '../../service-registry.js';
import type { WorkflowToolPolicy } from '../../workflow/chat-loop-contracts.js';

type Params = z.infer<typeof ChatCommand.schema>;
const _chatICommandSchema = z.object({
  employeeId: z.string().optional().describe('Agent id, name, or role query'),
  options: z
    .object({
      message: z.string().optional(),
      context: z.array(z.string()).optional(),
      mediatorLog: z.boolean().optional(),
      new: z.boolean().optional(),
      createNewSession: z.boolean().optional(),
      sessionId: z.string().optional(),
    })
    .optional()
    .default({}),
});

export const ChatCommandMetadata = {
  key: 'chat' as const,
  description: 'Start a chat session with an agent',
  availableIn: { cli: true, chat: false, tool: false },
  group: 'chat',
  parameters: _chatICommandSchema,
} satisfies ICommandDescriptor;

const CHAT_CONNECT_TIMEOUT_MS = 20_000;

interface WorkflowChatOptions {
  workflowMode?: boolean;
  workflowSystemPrompt?: string;
  workflowExitWords?: string[];
  suppressAutoIntroduction?: boolean;
  disableProcessExit?: boolean;
  toolPolicy?: WorkflowToolPolicy;
}

type ChatCommandOptions = ChatOptions & WorkflowChatOptions;
export type ChatRuntimeOptions = ChatCommandOptions;

function wireLlmDiagnostics(llm: ILlmService, emitService: IEmitService): void {
  llm.setDiagnosticReporter((entry) => {
    const level = entry.level === 'debug' ? 'info' : entry.level;
    emitService.log(level, entry.message);
  });
}

interface ChatResolvedDeps {
  teamConfig: TeamConfig;
  emitService: IEmitService;
  questionService: IQuestionService;
  chatInfoService: IChatInfoService;
  preflightService: IChatPreflightService;
  agentResolutionService: ICommand<string, Agent[]>;
  agentManager: IAgentManager;
  sessionManager: SessionManager;
  llmService: ILlmService;
  skillManager: ISkillManager;
  markdownSectionService: IMarkdownSectionService;
}

export class ChatCommand implements ICommand<Params, void> {
  static readonly schema = _chatICommandSchema;
  readonly metadata = ChatCommandMetadata;

  constructor(private readonly serviceContainer: IServiceContainer) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    let { employeeId } = payload;
    const rawOptions = payload.options ?? {};
    const createNewSession = rawOptions.createNewSession ?? rawOptions.new;
    const options: typeof rawOptions & { createNewSession?: boolean } = {
      ...rawOptions,
      createNewSession,
    };

    // When no agent is specified and no session is pinned, jump back to the
    // most recently active session regardless of which agent it belongs to.
    if (!employeeId && !options.sessionId && !createNewSession) {
      const sessionManager = this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.SessionManager);
      const recent = await sessionManager.listRecentSessions(1);
      if (recent.length > 0) {
        const last = recent[0];
        employeeId = last.agentId;
        options.sessionId = last.id;
      }
    }

    const runtimeCtx = ctx as unknown as {
      invocationSurface?: ExecutionContext['invocationSurface'];
      signal?: AbortSignal;
      workflowState?: unknown;
      onWorkflowFrame?: ExecutionContext['onWorkflowFrame'];
    };
    const hooks = {
      invocationSurface: runtimeCtx.invocationSurface,
      signal: runtimeCtx.signal,
      workflowState: runtimeCtx.workflowState as WorkflowStateSnapshot | undefined,
      onWorkflowFrame: runtimeCtx.onWorkflowFrame,
    };

    await this.executeRuntime(
      this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      employeeId,
      options,
      hooks
    );
    return { status: 'ok' };
  }

  public async executeRuntime(
    workspaceRoot: string,
    agentId: string | undefined,
    options: ChatRuntimeOptions,
    hooks: ChatRuntimeHooks = {}
  ): Promise<void> {
    setServiceContainer(this.serviceContainer);
    const deps = this.resolveDeps();

    try {
      const navStack: Array<{ agentId: string; sessionId: string; agentName: string }> = [];
      const prepared = await this.prepareChatSession({
        workspaceRoot,
        agentId,
        options,
        hooks,
        markdownSectionService: deps.markdownSectionService,
        preflightService: deps.preflightService,
        agentResolutionService: deps.agentResolutionService,
        sessionManager: deps.sessionManager,
        emitService: deps.emitService,
      });

      const { ctx, orchestrator } = await this.buildOrchestrator({
        workspaceRoot,
        currentSessionId: prepared.currentSessionId,
        agent: prepared.agent,
        history: prepared.history,
        instructions: prepared.instructions,
        llm: prepared.llm,
        hooks,
        sessionManager: deps.sessionManager,
        agentManager: deps.agentManager,
        skillManager: deps.skillManager,
        teamConfig: deps.teamConfig,
        questionService: deps.questionService,
        emitService: deps.emitService,
        toolPolicy: options.toolPolicy,
      });

      await this.runSingleMessageIfNeeded(orchestrator, options, hooks);
      if (options.oneShot) return;

      await this.runInteractiveLoop({
        ctx,
        orchestrator,
        options,
        hooks,
        developerName: prepared.developerName,
        navStack,
        loadSessionMessagesCommand: prepared.loadSessionMessagesCommand,
        currentSessionId: prepared.currentSessionId,
        initialAgent: prepared.agent,
        emitService: deps.emitService,
        questionService: deps.questionService,
        agentManager: deps.agentManager,
      });
    } catch (error) {
      if (isAbortError(error)) {
        deps.emitService.log('info', 'Chat aborted.');
        return;
      }

      deps.emitService.log(
        'error',
        `Error in chat: ${error instanceof Error ? error.message : String(error)}`
      );
      throw new Error(error instanceof Error ? error.message : String(error));
    } finally {
      try {
        await deps.sessionManager.close();
      } catch {
        // no-op
      }
    }
  }

  private resolveDeps(): ChatResolvedDeps {
    const configStorage = this.serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.ConfigurationStorage
    );
    const teamConfig = configStorage.get();
    const emitService = this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.EmitService);
    const questionService = this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.QuestionService);

    return {
      teamConfig,
      emitService,
      questionService,
      chatInfoService: new ChatInfoService(emitService),
      preflightService: new ChatPreflightService(
        teamConfig,
        configStorage,
        this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
        emitService,
        this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.ProviderConfigurationService)
      ),
      agentResolutionService: new InfoChatCommand(
        this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        questionService,
        this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.LlmService),
        emitService
      ),
      agentManager: this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      sessionManager: this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
      llmService: this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.LlmService),
      skillManager: this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
      markdownSectionService: this.serviceContainer.resolve(
        COMMAND_FACTORY_TOKENS.MarkdownSectionService
      ),
    };
  }

  private async prepareChatSession(params: {
    workspaceRoot: string;
    agentId: string | undefined;
    options: ChatCommandOptions;
    hooks: ChatRuntimeHooks;
    markdownSectionService: Pick<IMarkdownSectionService, 'parseMarkdownSections'>;
    preflightService: IChatPreflightService;
    agentResolutionService: ICommand<string, Agent[]>;
    sessionManager: SessionManager;
    emitService: IEmitService;
  }): Promise<{
    developerName: string;
    agent: Agent;
    llm: ILlmService;
    instructions: unknown;
    currentSessionId: string;
    history: ChatMessage[];
    loadSessionMessagesCommand: LoadSessionMessagesCommand;
  }> {
    const {
      workspaceRoot,
      agentId,
      options,
      hooks,
      markdownSectionService,
      preflightService,
      agentResolutionService,
      sessionManager,
      emitService,
    } = params;

    const runnerFactory = this.serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.WorkflowRunnerFactory
    );
    const { developerName: resolvedName } = await preflightService.resolve(workspaceRoot, hooks);
    const developerName = resolvedName ?? 'Developer';

    const resolveChatSessionCommand = new ResolveChatSessionCommand(
      sessionManager,
      this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService)
    );
    const loadSessionMessagesCommand = new LoadSessionMessagesCommand(sessionManager, emitService);

    const resolveCtx: ExecutionContext = {
      history: [],
      signal: hooks.signal,
      invocationSurface: hooks.invocationSurface,
    };

    const agentResolution = await agentResolutionService.execute(agentId ?? '', resolveCtx);
    if (agentResolution.status === 'error') {
      throw new Error(agentResolution.message);
    }

    const agent = agentResolution.data![0];
    const llm = await this.initializeLlm(hooks, emitService, sessionManager);
    const instructions = await this.loadSkillAndInstructions(agent, options, emitService);

    this.resolveDeps().chatInfoService.showSessionIntro({
      agent,
      developerName,
      workflowMode: options.workflowMode,
      workflowExitWords: options.workflowExitWords,
    });

    const workflowContext: ExecutionContext = {
      history: [],
      signal: hooks.signal,
      workflowState: hooks.workflowState,
      onWorkflowFrame: hooks.onWorkflowFrame as ExecutionContext['onWorkflowFrame'],
      invocationSurface: hooks.invocationSurface,
    };

    const startup = await runChatSessionStartupWorkflow(
      {
        currentAgentId: agent.id,
        options: {
          sessionId: options.sessionId,
          createNewSession: options.createNewSession,
        },
        developerName,
      },
      {
        resolveChatSessionCommand,
        loadSessionMessagesCommand,
      },
      workflowContext,
      runnerFactory
    );

    const currentSessionId = startup.sessionId;
    const history = startup.history;

    this.resolveDeps().chatInfoService.showSessionResume(history, agent.name, developerName);

    await this.handleInitialIntroductions({
      agent,
      history,
      developerName,
      sessionId: currentSessionId,
      options,
      hooks,
      markdownSectionService,
      sessionManager,
      emitService,
      agentManager: this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
    });

    return {
      developerName,
      agent,
      llm,
      instructions,
      currentSessionId,
      history,
      loadSessionMessagesCommand,
    };
  }

  private async initializeLlm(
    hooks: ChatRuntimeHooks,
    emitService: IEmitService,
    sessionManager: SessionManager
  ): Promise<ILlmService> {
    const llm = this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.LlmService);

    wireLlmDiagnostics(llm, emitService);
    const useSpinner = hooks.emitService === undefined && Boolean(process.stderr.isTTY);
    const spinner = useSpinner ? ora('Connecting to LLM...').start() : undefined;
    if (!spinner) emitService.log('info', 'Connecting to LLM...');

    try {
      await withAbortSignal(
        withTimeout(
          llm.initialize(),
          CHAT_CONNECT_TIMEOUT_MS,
          `LLM initialization timed out after ${CHAT_CONNECT_TIMEOUT_MS / 1000}s.`
        ),
        hooks.signal,
        'Chat connection aborted by user.'
      );

      if (spinner) {
        spinner.succeed(`Connected to ${llm.provider} using ${llm.modelName}`);
      } else {
        emitService.log('info', `Connected to ${llm.provider} using ${llm.modelName}`);
      }
      sessionManager.setAutoTitleLlmService(llm);
    } catch (error) {
      if (spinner) spinner.fail('Could not connect to configured LLM');
      emitService.log('error', (error as Error).message);
      emitService.log(
        'info',
        'Run "ait test-connection" to debug, or "ait init" to configure provider.'
      );
      throw new Error((error as Error).message);
    }

    return llm;
  }

  private async loadSkillAndInstructions(
    agent: Agent,
    options: ChatCommandOptions,
    emitService: IEmitService
  ) {
    const agentDocumentStorage = this.serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.AgentDocumentStorage
    );

    try {
      const skill = await agentDocumentStorage.loadSkillAsync(agent.skillPath);
      emitService.log('info', `Loaded skill: ${skill.name} (${agent.skillPath})`);
    } catch {
      emitService.log('info', `No skill file found for ${agent.role}, using agent portfolio only`);
    }

    let instructions = await agentDocumentStorage.loadAllInstructionFilesAsync();
    if (options.workflowSystemPrompt?.trim()) {
      instructions = [
        ...instructions,
        {
          filePath: '.ai-team/workflow-chat.instructions.md',
          applyTo: '**/*',
          instructions: options.workflowSystemPrompt.trim(),
        },
      ];
    }

    this.resolveDeps().chatInfoService.showLoadedInstructions(instructions.length);
    return instructions;
  }

  private async handleInitialIntroductions(params: {
    agent: Agent;
    history: ChatMessage[];
    developerName: string;
    sessionId: string;
    options: ChatCommandOptions;
    hooks: ChatRuntimeHooks;
    markdownSectionService: Pick<IMarkdownSectionService, 'parseMarkdownSections'>;
    sessionManager: SessionManager;
    emitService: IEmitService;
    agentManager: IAgentManager;
  }): Promise<void> {
    const {
      agent,
      history,
      developerName,
      sessionId,
      options,
      hooks,
      markdownSectionService,
      sessionManager,
      emitService,
      agentManager,
    } = params;

    if (history.length === 0 && !options.pendingIntroduction && !options.suppressAutoIntroduction) {
      await tryIntroduceUserNew({
        agentManager,
        markdownSectionService: markdownSectionService as IMarkdownSectionService,
        agent,
        history,
        developerName,
        sessionManager,
        sessionId,
        hooks,
        emitService,
      });
    }

    if (options.pendingIntroduction && history.length === 0) {
      if (!hooks.emitService) {
        emitService.token(`\n${agent.name} (${agent.role}): `);
      }
      emitService.token(`${options.pendingIntroduction}\n\n`);

      const introMsg: ChatMessage = {
        timestamp: new Date().toISOString(),
        from: agent.id,
        to: 'human',
        content: options.pendingIntroduction,
        importance: 'low',
      };
      await sessionManager.appendMessage(sessionId, introMsg);
      history.push(introMsg);
    }
  }

  private async buildOrchestrator(params: {
    workspaceRoot: string;
    currentSessionId: string;
    agent: Agent;
    history: ChatMessage[];
    instructions: unknown;
    llm: ILlmService;
    hooks: ChatRuntimeHooks;
    sessionManager: SessionManager;
    agentManager: IAgentManager;
    skillManager: ISkillManager;
    teamConfig: TeamConfig;
    questionService: IQuestionService;
    emitService: IEmitService;
    toolPolicy?: WorkflowToolPolicy;
  }): Promise<{ ctx: ExecutionContext; orchestrator: ChatOrchestrator }> {
    const {
      workspaceRoot,
      currentSessionId,
      agent,
      history,
      instructions,
      llm,
      hooks,
      sessionManager,
      agentManager,
      skillManager,
      teamConfig,
      questionService,
      emitService,
      toolPolicy,
    } = params;

    const chatToolManager = this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.ToolManager);
    const toolDispatchSupport = this.serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.ToolDispatchSupportService
    );
    const toolSerialization = this.serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.ToolSerializationService
    );

    const toolDispatcher = new ToolDispatcher(
      chatToolManager,
      sessionManager,
      toolDispatchSupport,
      questionService,
      emitService
    );

    const ctx: ExecutionContext = {
      agent,
      sessionId: currentSessionId,
      history,
      instructions,
    };

    const commandDispatcher = createCommandDispatcher(workspaceRoot, this.serviceContainer);
    const reservedSlashKeys = new Set(
      commandDispatcher.getCommands({ chat: true }).flatMap((e) => [e.key, ...(e.aliases ?? [])])
    );

    const dynamicSlashCatalog = await buildDynamicSlashCatalog({
      workspaceRoot,
      skillManager,
      reservedKeys: reservedSlashKeys,
      emitService,
      dynamicSlashCatalog: readDynamicSlashCatalogConfig({
        dynamicSlashCatalog: (teamConfig as any)?.dynamicSlashCatalog ?? undefined,
      }),
    });

    for (const warning of dynamicSlashCatalog.warnings) {
      emitService.log('warn', warning);
    }

    commandDispatcher.registerDynamic(dynamicSlashCatalog.entries, emitService);

    const plugins: ResolvedPlugins = {
      compressor: new NoOpCompressor(),
      contextBuilder: new DefaultContextBuilder(),
      enrichers: [
        new WorkspaceOverviewEnricher(workspaceRoot),
        new TeamRosterEnricher(agentManager),
      ],
      ragProvider: new NoOpRagProvider(),
      toolResolver: toolPolicy
        ? new WorkflowToolResolver(new DefaultToolResolver(chatToolManager), toolPolicy)
        : new DefaultToolResolver(chatToolManager),
      mcpGateway: new NoOpMcpGateway(),
      llmSelector: new DefaultLlmSelector(llm),
      outputHandler: new DefaultOutputHandler(emitService),
      commandDispatcher,
      turnResultParsers: buildDefaultTurnResultParsers(),
      hookPlugins: buildDefaultHookPlugins(),
      preLlmIntentProviders: [new WorkflowIntentProvider()],
    };

    const handoffOrchestrator = new HandoffOrchestrator(
      agentManager,
      sessionManager,
      llm,
      emitService
    );

    const orchestratorHooks: ChatRuntimeHooks = { ...hooks, skillManager };
    const orchestrator = new ChatOrchestrator(
      ctx,
      plugins,
      toolDispatcher,
      handoffOrchestrator,
      orchestratorHooks,
      agentManager,
      sessionManager,
      llm,
      toolSerialization,
      chatToolManager
    );

    return { ctx, orchestrator };
  }

  private async runSingleMessageIfNeeded(
    orchestrator: ChatOrchestrator,
    options: ChatCommandOptions,
    hooks: ChatRuntimeHooks
  ): Promise<void> {
    if (!options.message) return;

    await withAbortSignal(
      orchestrator.run({ message: options.message, contextFiles: options.context }),
      hooks.signal,
      'Chat request aborted by user.'
    );
  }

  private async runInteractiveLoop(params: {
    ctx: ExecutionContext;
    orchestrator: ChatOrchestrator;
    options: ChatCommandOptions;
    hooks: ChatRuntimeHooks;
    developerName: string;
    navStack: Array<{ agentId: string; sessionId: string; agentName: string }>;
    loadSessionMessagesCommand: LoadSessionMessagesCommand;
    currentSessionId: string;
    initialAgent: Agent;
    emitService: IEmitService;
    questionService: IQuestionService;
    agentManager: IAgentManager;
  }): Promise<void> {
    const {
      ctx,
      orchestrator,
      options,
      hooks,
      developerName,
      navStack,
      loadSessionMessagesCommand,
      currentSessionId,
      initialAgent,
      emitService,
      questionService,
      agentManager,
    } = params;

    while (true) {
      throwIfAborted(hooks.signal, 'Chat request aborted by user.');

      const promptAgent = ctx.agent ?? initialAgent;
      const message = await withAbortSignal(
        questionService.input({
          message: formatUserPrompt(promptAgent, developerName),
          validate: (val: string) => val.length > 0 || 'Message cannot be empty',
        }),
        hooks.signal,
        'Chat input aborted by user.'
      );

      const normalizedMessage = message.trim().toLowerCase();
      if (normalizedMessage === 'exit') {
        emitService.log('info', 'Goodbye!');
        if (options.disableProcessExit || options.workflowMode) {
          return;
        }
        process.exit(0);
      }

      if (
        options.workflowMode &&
        options.workflowExitWords?.some((word) => word.trim().toLowerCase() === normalizedMessage)
      ) {
        emitService.log('info', 'Moving to the next workflow step...');
        return;
      }

      if (message.trim() === '/back') {
        await this.handleBackNavigation({
          ctx,
          navStack,
          loadSessionMessagesCommand,
          emitService,
          agentManager,
        });
        continue;
      }

      const prevAgentId = (ctx.agent ?? initialAgent).id;
      const prevSessionId = ctx.sessionId ?? currentSessionId;
      await withAbortSignal(
        orchestrator.run({ message, contextFiles: options.context }),
        hooks.signal,
        'Chat request aborted by user.'
      );
      if (ctx.agent?.id !== prevAgentId) {
        navStack.push({ agentId: prevAgentId, sessionId: prevSessionId, agentName: prevAgentId });
      }
    }
  }

  private async handleBackNavigation(params: {
    ctx: ExecutionContext;
    navStack: Array<{ agentId: string; sessionId: string; agentName: string }>;
    loadSessionMessagesCommand: LoadSessionMessagesCommand;
    emitService: IEmitService;
    agentManager: IAgentManager;
  }): Promise<void> {
    const { ctx, navStack, loadSessionMessagesCommand, emitService, agentManager } = params;

    if (navStack.length === 0) {
      emitService.log('warn', 'No previous agent to return to.');
      emitService.log('info', '');
      return;
    }

    const prev = navStack.pop()!;
    const prevAgent = await agentManager.getAgentAsync(prev.agentId);
    if (!prevAgent) {
      emitService.log('error', `Previous agent ${prev.agentId} no longer found.`);
      return;
    }

    const prevHistory = await loadSessionMessagesCommand.execute({
      sessionId: prev.sessionId,
      reason: 'back-nav',
    });

    ctx.agent = prevAgent;
    ctx.sessionId = prev.sessionId;
    ctx.history = prevHistory;
    emitService.log('info', `\n← Returned to ${prevAgent.name} (${prevAgent.role})\n`);
  }
}
