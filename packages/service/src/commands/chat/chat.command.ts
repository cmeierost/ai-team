import ora from 'ora';
import type {
  ChatMessage,
  Agent,
  IAgentManager,
  ICommand,
  IServiceContainer,
  IConfigurationStorage,
  IEnvironmentStorage,
  IDeveloperIdentityService,
  IAgentDocumentStorage,
  ExecutionContext,
  IPathPermissionChecker,
  ILlmService,
  IMarkdownSectionService,
  IProposalStoreFactory,
  ISkillManager,
} from '@ai-team/core';
import type { ChatOptions, IContextService } from '@ai-team/api-contracts';
import { SessionManager } from '../../session-manager.js';
import { ChatOrchestrator } from '../../orchestrator/chat-orchestrator.js';
import { tryIntroduceUser as tryIntroduceUserNew } from '../../orchestrator/introduction.js';
import type { ResolvedPlugins } from '../../orchestrator/pipeline.js';
import {
  EmitService,
  formatConsoleArgs,
  type IEmitService,
} from '../../orchestrator/services/emit-service.js';
import { NoOpCompressor } from '../../orchestrator/defaults/context-compressor.js';
import { DefaultContextBuilder } from '../../orchestrator/defaults/context-builder.js';
import {
  WorkspaceOverviewEnricher,
  TeamRosterEnricher,
} from '../../orchestrator/defaults/context-enrichers.js';
import { NoOpRagProvider } from '../../orchestrator/defaults/rag-provider.js';
import { DefaultToolResolver } from '../../orchestrator/defaults/tool-resolver.js';
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
import { requestInput } from '../com/questions.js';
import { formatUserPrompt } from '../../utils/agent-selection.js';
import type { IChatInfoService } from '../../orchestrator/chat-info-service.js';
import type { IChatPreflightService } from '../../orchestrator/chat-preflight-service.js';
import { ResolveChatSessionCommand } from './resolve-chat-session.command.js';
import { LoadSessionMessagesCommand } from './load-session-messages.command.js';
import { runChatSessionStartupWorkflow } from './chat-session-startup.workflow.js';
import { COMMAND_FACTORY_TOKENS } from '../../types.js';
import { setServiceContainer } from '../../service-registry.js';

// ── Dep interfaces ────────────────────────────────────────────────────────────

export interface ChatConfigIdentityDeps {
  configurationStorage: Pick<IConfigurationStorage, 'loadEffectiveConfigAsync'>;
  environmentStorage: Pick<IEnvironmentStorage, 'loadEnvFileAsync' | 'saveEnvFileAsync'>;
  developerIdentityService: Pick<
    IDeveloperIdentityService,
    'getUserName' | 'getUserEmail' | 'toDeveloperId'
  >;
  contextService: Pick<IContextService, 'getContextEstimate'>;
}

export interface ChatAgentKnowledgeDeps {
  agentManager: Pick<
    IAgentManager,
    'getAllAgentsAsync' | 'resolveAgentAsync' | 'getAgentAsync' | 'recordInteractionAsync'
  >;
  agentDocumentStorage: Pick<
    IAgentDocumentStorage,
    'loadSkillAsync' | 'loadAllInstructionFilesAsync'
  >;
  markdownSectionService: Pick<IMarkdownSectionService, 'parseMarkdownSections'>;
  skillManager: ISkillManager;
}

export interface ChatSessionExecutionDeps {
  sessionManager: Pick<
    SessionManager,
    | 'getSessionMessages'
    | 'createSession'
    | 'getLatestSession'
    | 'listRecentSessions'
    | 'appendMessage'
    | 'setAutoTitleLlmService'
    | 'close'
  >;
  llmService: Pick<ILlmService, 'initialize' | 'setDiagnosticReporter' | 'provider' | 'modelName'>;
  proposalStoreFactory: IProposalStoreFactory;
}

export interface ChatOrchestrationDeps {
  pathPermissionChecker: IPathPermissionChecker;
  serviceContainer: IServiceContainer;
}

// ─────────────────────────────────────────────────────────────────────────────

const CHAT_CONNECT_TIMEOUT_MS = 20_000;

interface WorkflowChatOptions {
  workflowMode?: boolean;
  workflowSystemPrompt?: string;
  workflowExitWords?: string[];
  suppressAutoIntroduction?: boolean;
  disableProcessExit?: boolean;
}

type ChatCommandOptions = ChatOptions & WorkflowChatOptions;

function wireLlmDiagnostics(llm: ILlmService, emitService: IEmitService): void {
  llm.setDiagnosticReporter((entry) => {
    const level = entry.level === 'debug' ? 'info' : entry.level;
    emitService.log(level, entry.message);
  });
}

// ─────────────────────────────────────────────────────────────────────────────

export class ChatCommand {
  constructor(
    private readonly configIdentityDeps: ChatConfigIdentityDeps,
    private readonly agentKnowledgeDeps: ChatAgentKnowledgeDeps,
    private readonly sessionExecutionDeps: ChatSessionExecutionDeps,
    private readonly orchestrationDeps: ChatOrchestrationDeps,
    private readonly chatInfoService: IChatInfoService,
    private readonly preflightService: IChatPreflightService,
    private readonly agentResolutionService: ICommand<string, Agent[]>
  ) {}

  async execute(
    workspaceRoot: string,
    agentId: string | undefined,
    options: ChatCommandOptions,
    hooks: ChatRuntimeHooks = {}
  ) {
    const { configurationStorage } = this.configIdentityDeps;
    const { markdownSectionService, skillManager } = this.agentKnowledgeDeps;
    const { serviceContainer } = this.orchestrationDeps;
    setServiceContainer(serviceContainer);
    const questionService = serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.QuestionService
    ) as IQuestionService;

    return this.runWithEmitter({
      workspaceRoot,
      agentId,
      options,
      hooks,
      configurationStorage,
      markdownSectionService,
      skillManager,
      serviceContainer,
      questionService,
    });
  }

  private async runWithEmitter(params: {
    workspaceRoot: string;
    agentId: string | undefined;
    options: ChatCommandOptions;
    hooks: ChatRuntimeHooks;
    configurationStorage: Pick<IConfigurationStorage, 'loadEffectiveConfigAsync'>;
    markdownSectionService: Pick<IMarkdownSectionService, 'parseMarkdownSections'>;
    skillManager: ISkillManager;
    serviceContainer: IServiceContainer;
    questionService: IQuestionService;
  }): Promise<void> {
    const {
      workspaceRoot,
      agentId,
      options,
      hooks,
      configurationStorage,
      markdownSectionService,
      skillManager,
      serviceContainer,
      questionService,
    } = params;
    const emitService: IEmitService = hooks.emitService ?? EmitService.forConsole();
    const restoreConsole = this.applyConsoleHookOverrides(hooks, emitService);

    try {
      const navStack: Array<{ agentId: string; sessionId: string; agentName: string }> = [];
      const prepared = await this.prepareChatSession({
        workspaceRoot,
        agentId,
        options,
        hooks,
        markdownSectionService,
        serviceContainer,
        emitService,
      });

      const { ctx, orchestrator } = await this.buildOrchestrator({
        workspaceRoot,
        currentSessionId: prepared.currentSessionId,
        agent: prepared.agent,
        history: prepared.history,
        instructions: prepared.instructions,
        llm: prepared.llm,
        hooks,
        serviceContainer,
        skillManager,
        configurationStorage,
        questionService,
        emitService,
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
        emitService,
      });
    } catch (error) {
      if (isAbortError(error)) {
        emitService.log('info', 'Chat aborted.');
        return;
      }
      emitService.log(
        'error',
        `Error in chat: ${error instanceof Error ? error.message : String(error)}`
      );
      throw new Error(error instanceof Error ? error.message : String(error));
    } finally {
      if (this.sessionExecutionDeps.sessionManager) {
        try {
          await this.sessionExecutionDeps.sessionManager.close();
        } catch {}
      }
      restoreConsole();
    }
  }

  private async prepareChatSession(params: {
    workspaceRoot: string;
    agentId: string | undefined;
    options: ChatCommandOptions;
    hooks: ChatRuntimeHooks;
    markdownSectionService: Pick<IMarkdownSectionService, 'parseMarkdownSections'>;
    serviceContainer: IServiceContainer;
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
      serviceContainer,
      emitService,
    } = params;
    const runnerFactory = serviceContainer.resolve(COMMAND_FACTORY_TOKENS.WorkflowRunnerFactory);
    const { developerName, agent, resolveChatSessionCommand, loadSessionMessagesCommand } =
      await this.resolveAgentAndIdentity(workspaceRoot, agentId, hooks, emitService);

    const llm = await this.initializeLlm(hooks, emitService);

    const instructions = await this.loadSkillAndInstructions(
      workspaceRoot,
      agent,
      options,
      hooks,
      emitService
    );
    this.chatInfoService.showSessionIntro({
      agent,
      developerName,
      workflowMode: options.workflowMode,
      workflowExitWords: options.workflowExitWords,
    });

    const workflowContext: ExecutionContext = {
      workspaceRoot,
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
    this.chatInfoService.showSessionResume(history, agent.name, developerName);

    await this.handleInitialIntroductions({
      agent,
      history,
      developerName,
      sessionId: currentSessionId,
      options,
      hooks,
      markdownSectionService,
      emitService,
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

  private applyConsoleHookOverrides(
    hooks: ChatRuntimeHooks,
    emitService: IEmitService
  ): () => void {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const shouldPatch = hooks.emitService !== undefined;

    if (shouldPatch) {
      console.log = (...args: unknown[]) => emitService.log('info', formatConsoleArgs(args));
      console.warn = (...args: unknown[]) => emitService.log('warn', formatConsoleArgs(args));
      console.error = (...args: unknown[]) => emitService.log('error', formatConsoleArgs(args));
    }

    return () => {
      if (shouldPatch) {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
      }
    };
  }

  private async resolveAgentAndIdentity(
    workspaceRoot: string,
    agentId: string | undefined,
    hooks: ChatRuntimeHooks,
    emitService: IEmitService
  ): Promise<{
    developerName: string;
    agent: Agent;
    resolveChatSessionCommand: ResolveChatSessionCommand;
    loadSessionMessagesCommand: LoadSessionMessagesCommand;
  }> {
    const { developerIdentityService } = this.configIdentityDeps;

    const { developerName: resolvedName } = await this.preflightService.resolve(
      workspaceRoot,
      hooks
    );
    const developerName = resolvedName ?? 'Developer';
    const resolveChatSessionCommand = new ResolveChatSessionCommand(
      this.sessionExecutionDeps.sessionManager,
      developerIdentityService
    );
    const loadSessionMessagesCommand = new LoadSessionMessagesCommand(
      this.sessionExecutionDeps.sessionManager,
      emitService
    );

    const resolveCtx: ExecutionContext = {
      workspaceRoot,
      history: [],
      signal: hooks.signal,
      invocationSurface: hooks.invocationSurface,
    };
    const agentResolution = await this.agentResolutionService.execute(agentId ?? '', resolveCtx);
    if (agentResolution.status === 'error') throw new Error(agentResolution.message);

    return {
      developerName,
      agent: agentResolution.data![0],
      resolveChatSessionCommand,
      loadSessionMessagesCommand,
    };
  }

  private async initializeLlm(
    hooks: ChatRuntimeHooks,
    emitService: IEmitService
  ): Promise<ILlmService> {
    const llm = this.sessionExecutionDeps.llmService as ILlmService;
    if (!llm) throw new Error('ChatCommand: llmService is required but was not provided');

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
        hooks?.signal,
        'Chat connection aborted by user.'
      );
      if (spinner) {
        spinner.succeed(`Connected to ${llm.provider} using ${llm.modelName}`);
      } else {
        emitService.log('info', `Connected to ${llm.provider} using ${llm.modelName}`);
      }
      this.sessionExecutionDeps.sessionManager.setAutoTitleLlmService(llm);
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
    workspaceRoot: string,
    agent: Agent,
    options: ChatCommandOptions,
    hooks: ChatRuntimeHooks,
    emitService: IEmitService
  ) {
    const { agentDocumentStorage } = this.agentKnowledgeDeps;

    try {
      const skill = await agentDocumentStorage.loadSkillAsync(agent.skillPath);
      emitService.log('info', `Loaded skill: ${skill.name} (${agent.skillPath})`);
    } catch {
      emitService.log('info', `No skill file found for ${agent.role}, using agent portfolio only`);
    }

    let instructions = await agentDocumentStorage.loadAllInstructionFilesAsync(workspaceRoot);
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

    this.chatInfoService.showLoadedInstructions(instructions.length);
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
    emitService: IEmitService;
  }): Promise<void> {
    const {
      agent,
      history,
      developerName,
      sessionId,
      options,
      hooks,
      markdownSectionService,
      emitService,
    } = params;

    if (history.length === 0 && !options.pendingIntroduction && !options.suppressAutoIntroduction) {
      await tryIntroduceUserNew({
        agentManager: this.agentKnowledgeDeps.agentManager as IAgentManager,
        markdownSectionService: markdownSectionService as IMarkdownSectionService,
        agent,
        history,
        developerName,
        sessionManager: this.sessionExecutionDeps.sessionManager as SessionManager,
        sessionId,
        hooks,
        emitService,
      });
    }

    if (options.pendingIntroduction && history.length === 0) {
      const introMsg: ChatMessage = {
        timestamp: new Date().toISOString(),
        from: agent.id,
        to: 'human',
        content: options.pendingIntroduction,
        importance: 'low',
      };
      if (this.sessionExecutionDeps.sessionManager) {
        await this.sessionExecutionDeps.sessionManager.appendMessage(sessionId, introMsg);
      }
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
    serviceContainer: IServiceContainer;
    skillManager: ISkillManager;
    configurationStorage: Pick<IConfigurationStorage, 'loadEffectiveConfigAsync'>;
    questionService: IQuestionService;
    emitService: IEmitService;
  }): Promise<{ ctx: ExecutionContext; orchestrator: ChatOrchestrator }> {
    const {
      workspaceRoot,
      currentSessionId,
      agent,
      history,
      instructions,
      llm,
      hooks,
      serviceContainer,
      skillManager,
      configurationStorage,
      questionService,
      emitService,
    } = params;

    const chatToolManager = serviceContainer.resolve(COMMAND_FACTORY_TOKENS.ToolManager);
    const toolDispatchSupport = serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.ToolDispatchSupportService
    );
    const toolSerialization = serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.ToolSerializationService
    );

    const toolDispatcher = new ToolDispatcher(
      chatToolManager,
      this.sessionExecutionDeps.sessionManager as SessionManager,
      toolDispatchSupport,
      questionService,
      emitService
    );

    const ctx: ExecutionContext = {
      agent,
      workspaceRoot,
      sessionId: currentSessionId,
      history,
      instructions,
    };

    const commandDispatcher = createCommandDispatcher(workspaceRoot, serviceContainer);
    const reservedSlashKeys = new Set(
      commandDispatcher.getCommands({ chat: true }).flatMap((e) => [e.key, ...(e.aliases ?? [])])
    );

    const dynamicSlashCatalog = await buildDynamicSlashCatalog({
      workspaceRoot,
      skillManager,
      reservedKeys: reservedSlashKeys,
      emitService,
      dynamicSlashCatalog: readDynamicSlashCatalogConfig(
        await configurationStorage.loadEffectiveConfigAsync(workspaceRoot)
      ),
    });

    for (const warning of dynamicSlashCatalog.warnings) {
      emitService.log('warn', warning);
    }

    commandDispatcher.registerDynamic(dynamicSlashCatalog.entries, emitService);

    const plugins: ResolvedPlugins = {
      compressor: new NoOpCompressor(),
      contextBuilder: new DefaultContextBuilder(),
      enrichers: [
        new WorkspaceOverviewEnricher(),
        new TeamRosterEnricher(this.agentKnowledgeDeps.agentManager as IAgentManager),
      ],
      ragProvider: new NoOpRagProvider(),
      toolResolver: new DefaultToolResolver(chatToolManager),
      mcpGateway: new NoOpMcpGateway(),
      llmSelector: new DefaultLlmSelector(llm),
      outputHandler: new DefaultOutputHandler(emitService),
      commandDispatcher,
      turnResultParsers: buildDefaultTurnResultParsers(),
      hookPlugins: buildDefaultHookPlugins(),
      preLlmIntentProviders: [new WorkflowIntentProvider()],
    };

    const handoffOrchestrator = new HandoffOrchestrator(
      this.agentKnowledgeDeps.agentManager as IAgentManager,
      this.sessionExecutionDeps.sessionManager as SessionManager,
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
      this.agentKnowledgeDeps.agentManager as IAgentManager,
      this.sessionExecutionDeps.sessionManager as SessionManager,
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
    } = params;

    if (!hooks.questionInput) return;

    while (true) {
      throwIfAborted(hooks.signal, 'Chat request aborted by user.');

      const promptAgent = ctx.agent ?? initialAgent;
      const message = await withAbortSignal(
        requestInput(hooks, {
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
          hooks,
          navStack,
          loadSessionMessagesCommand,
          emitService,
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
    hooks: ChatRuntimeHooks;
    navStack: Array<{ agentId: string; sessionId: string; agentName: string }>;
    loadSessionMessagesCommand: LoadSessionMessagesCommand;
    emitService: IEmitService;
  }): Promise<void> {
    const { ctx, navStack, loadSessionMessagesCommand, emitService } = params;

    if (navStack.length === 0) {
      emitService.log('warn', 'No previous agent to return to.');
      emitService.log('info', '');
      return;
    }

    const prev = navStack.pop()!;
    const prevAgent = await this.agentKnowledgeDeps.agentManager.getAgentAsync(prev.agentId);
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
