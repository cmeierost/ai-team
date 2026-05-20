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
import { XStateChatOrchestrator } from '../../orchestrator/xstate-chat-orchestrator.js';
import { tryIntroduceUser as tryIntroduceUserNew } from '../../orchestrator/introduction.js';
import type { ResolvedPlugins } from '../../orchestrator/pipeline.js';
import {
  emitRuntimeEvent,
  formatConsoleArgs,
  writeInfo,
  writeWarn,
  writeError,
} from '../../orchestrator/chat-emitter.js';
import type { ToolManager } from '../../tools/tool-manager.js';
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
import { buildDefaultSlashCommands } from '../../orchestrator/slash-commands.js';
import { ToolDispatcher } from '../../orchestrator/tool-dispatch.js';
import { HandoffOrchestrator } from '../../orchestrator/handoff.js';
import type { IQuestionService } from '../../questions/question-service.js';
import { WorkflowIntentProvider } from '../../tools/workflow-intent-provider.js';
import {
  buildDynamicSlashCatalog,
  buildDynamicSlashCommands,
} from '../../orchestrator/dynamic-slash/catalog.js';
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

type ChatExecutionContext = ExecutionContext & {
  toolManager: ToolManager;
  toolDispatcher: ToolDispatcher;
  sessionManager: SessionManager;
  hooks: ChatRuntimeHooks;
};

function wireLlmDiagnostics(llm: ILlmService, hooks: ChatRuntimeHooks | undefined): void {
  llm.setDiagnosticReporter((entry) => {
    if (entry.level === 'error') {
      writeError(hooks, entry.message);
      return;
    }
    if (entry.level === 'warn') {
      writeWarn(hooks, entry.message);
      return;
    }
    writeInfo(hooks, entry.message);
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
    const emitService = serviceContainer.resolve(COMMAND_FACTORY_TOKENS.EmitService);
    const questionService = serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.QuestionService
    ) as IQuestionService;

    return emitService.runWithEmitter(hooks.emit, () =>
      this.runWithEmitter({
        workspaceRoot,
        agentId,
        options,
        hooks,
        configurationStorage,
        markdownSectionService,
        skillManager,
        serviceContainer,
        questionService,
      })
    );
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
    const restoreConsole = this.applyConsoleHookOverrides(hooks);

    try {
      const navStack: Array<{ agentId: string; sessionId: string; agentName: string }> = [];
      const prepared = await this.prepareChatSession({
        workspaceRoot,
        agentId,
        options,
        hooks,
        markdownSectionService,
        questionService,
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
      });
    } catch (error) {
      if (isAbortError(error)) {
        writeInfo(hooks, 'Chat aborted.');
        return;
      }
      writeError(hooks, `Error in chat: ${error instanceof Error ? error.message : String(error)}`);
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
    questionService: IQuestionService;
  }): Promise<{
    developerName: string;
    agent: Agent;
    llm: ILlmService;
    instructions: unknown;
    currentSessionId: string;
    history: ChatMessage[];
    loadSessionMessagesCommand: LoadSessionMessagesCommand;
  }> {
    const { workspaceRoot, agentId, options, hooks, markdownSectionService, questionService } =
      params;
    const { developerName, agent, resolveChatSessionCommand, loadSessionMessagesCommand } =
      await this.resolveAgentAndIdentity(workspaceRoot, agentId, hooks);

    const llm = await this.initializeLlm(hooks);

    const instructions = await this.loadSkillAndInstructions(workspaceRoot, agent, options, hooks);
    this.chatInfoService.showSessionIntro({
      sink: hooks,
      agent,
      developerName,
      workflowMode: options.workflowMode,
      workflowExitWords: options.workflowExitWords,
    });

    const workflowContext: ExecutionContext = {
      workspaceRoot,
      history: [],
      signal: hooks.signal,
      emit: hooks.emit ? (event: unknown) => hooks.emit!(event as any) : undefined,
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
        sink: hooks,
      },
      {
        resolveChatSessionCommand,
        loadSessionMessagesCommand,
      },
      workflowContext,
      questionService
    );
    const currentSessionId = startup.sessionId;
    const history = startup.history;
    this.chatInfoService.showSessionResume(history, agent.name, developerName, hooks);

    await this.handleInitialIntroductions({
      agent,
      history,
      developerName,
      sessionId: currentSessionId,
      options,
      hooks,
      markdownSectionService,
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

  private applyConsoleHookOverrides(hooks: ChatRuntimeHooks): () => void {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    if (hooks.emit) {
      console.log = (...args: unknown[]) =>
        emitRuntimeEvent(hooks, { kind: 'log', level: 'info', message: formatConsoleArgs(args) });
      console.warn = (...args: unknown[]) =>
        emitRuntimeEvent(hooks, { kind: 'log', level: 'warn', message: formatConsoleArgs(args) });
      console.error = (...args: unknown[]) =>
        emitRuntimeEvent(hooks, { kind: 'log', level: 'error', message: formatConsoleArgs(args) });
    }

    return () => {
      if (hooks.emit) {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
      }
    };
  }

  private async resolveAgentAndIdentity(
    workspaceRoot: string,
    agentId: string | undefined,
    hooks: ChatRuntimeHooks
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
      this.sessionExecutionDeps.sessionManager
    );

    const resolveCtx: ExecutionContext = {
      workspaceRoot,
      history: [],
      signal: hooks.signal,
      emit: hooks.emit ? (event: unknown) => hooks.emit!(event as any) : undefined,
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

  private async initializeLlm(hooks: ChatRuntimeHooks): Promise<ILlmService> {
    const llm = this.sessionExecutionDeps.llmService as ILlmService;
    if (!llm) throw new Error('ChatCommand: llmService is required but was not provided');

    wireLlmDiagnostics(llm, hooks);
    const useSpinner = !hooks?.emit && Boolean(process.stderr.isTTY);
    const spinner = useSpinner ? ora('Connecting to LLM...').start() : undefined;
    if (!spinner) writeInfo(hooks, 'Connecting to LLM...');

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
        writeInfo(hooks, `Connected to ${llm.provider} using ${llm.modelName}`);
      }
      this.sessionExecutionDeps.sessionManager.setAutoTitleLlmService(llm);
    } catch (error) {
      if (spinner) spinner.fail('Could not connect to configured LLM');
      writeError(hooks, (error as Error).message);
      writeInfo(hooks, 'Run "ait test-connection" to debug, or "ait init" to configure provider.');
      throw new Error((error as Error).message);
    }

    return llm;
  }

  private async loadSkillAndInstructions(
    workspaceRoot: string,
    agent: Agent,
    options: ChatCommandOptions,
    hooks: ChatRuntimeHooks
  ) {
    const { agentDocumentStorage } = this.agentKnowledgeDeps;

    try {
      const skill = await agentDocumentStorage.loadSkillAsync(agent.skillPath);
      writeInfo(hooks, `Loaded skill: ${skill.name} (${agent.skillPath})`);
    } catch {
      writeInfo(hooks, `No skill file found for ${agent.role}, using agent portfolio only`);
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

    this.chatInfoService.showLoadedInstructions(hooks, instructions.length);
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
  }): Promise<void> {
    const { agent, history, developerName, sessionId, options, hooks, markdownSectionService } =
      params;

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
  }): Promise<{ ctx: ChatExecutionContext; orchestrator: XStateChatOrchestrator }> {
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
      questionService
    );

    const ctx: ChatExecutionContext = {
      agent,
      workspaceRoot,
      sessionId: currentSessionId,
      hooks,
      toolManager: chatToolManager,
      sessionManager: this.sessionExecutionDeps.sessionManager as SessionManager,
      agentManager: this.agentKnowledgeDeps.agentManager,
      skillManager,
      llmService: llm as any,
      toolDispatcher,
      history,
      instructions,
    };

    const registry = serviceContainer.resolve(COMMAND_FACTORY_TOKENS.CommandRegistry);
    const staticSlashCommands = buildDefaultSlashCommands(registry);

    const reservedSlashKeys = new Set<string>();
    for (const command of staticSlashCommands) {
      reservedSlashKeys.add(command.key.toLowerCase());
      for (const alias of command.aliases ?? []) {
        reservedSlashKeys.add(alias.toLowerCase());
      }
    }

    const dynamicSlashCatalog = await buildDynamicSlashCatalog({
      workspaceRoot,
      skillManager,
      reservedKeys: reservedSlashKeys,
      dynamicSlashCatalog: readDynamicSlashCatalogConfig(
        await configurationStorage.loadEffectiveConfigAsync(workspaceRoot)
      ),
    });

    for (const warning of dynamicSlashCatalog.warnings) {
      writeWarn(hooks, warning);
    }

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
      outputHandler: new DefaultOutputHandler(),
      slashCommands: [
        ...staticSlashCommands,
        ...buildDynamicSlashCommands(dynamicSlashCatalog.entries),
      ],
      turnResultParsers: buildDefaultTurnResultParsers(
        this.agentKnowledgeDeps.agentManager as IAgentManager
      ),
      hookPlugins: buildDefaultHookPlugins(),
      preLlmIntentProviders: [new WorkflowIntentProvider()],
    };

    const handoffOrchestrator = new HandoffOrchestrator(
      this.agentKnowledgeDeps.agentManager as IAgentManager,
      this.sessionExecutionDeps.sessionManager as SessionManager,
      llm
    );

    const orchestrator = new XStateChatOrchestrator(
      ctx,
      plugins,
      toolDispatcher,
      handoffOrchestrator,
      hooks,
      this.agentKnowledgeDeps.agentManager as IAgentManager,
      this.sessionExecutionDeps.sessionManager as SessionManager,
      llm,
      toolSerialization
    );

    return { ctx, orchestrator };
  }

  private async runSingleMessageIfNeeded(
    orchestrator: XStateChatOrchestrator,
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
    ctx: ChatExecutionContext;
    orchestrator: XStateChatOrchestrator;
    options: ChatCommandOptions;
    hooks: ChatRuntimeHooks;
    developerName: string;
    navStack: Array<{ agentId: string; sessionId: string; agentName: string }>;
    loadSessionMessagesCommand: LoadSessionMessagesCommand;
    currentSessionId: string;
    initialAgent: Agent;
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
        writeInfo(hooks, 'Goodbye!');
        if (options.disableProcessExit || options.workflowMode) {
          return;
        }
        process.exit(0);
      }

      if (
        options.workflowMode &&
        options.workflowExitWords?.some((word) => word.trim().toLowerCase() === normalizedMessage)
      ) {
        writeInfo(hooks, 'Moving to the next workflow step...');
        return;
      }

      if (message.trim() === '/back') {
        await this.handleBackNavigation({ ctx, hooks, navStack, loadSessionMessagesCommand });
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
    ctx: ChatExecutionContext;
    hooks: ChatRuntimeHooks;
    navStack: Array<{ agentId: string; sessionId: string; agentName: string }>;
    loadSessionMessagesCommand: LoadSessionMessagesCommand;
  }): Promise<void> {
    const { ctx, hooks, navStack, loadSessionMessagesCommand } = params;

    if (navStack.length === 0) {
      writeWarn(hooks, 'No previous agent to return to.');
      writeInfo(hooks, '');
      return;
    }

    const prev = navStack.pop()!;
    const prevAgent = await this.agentKnowledgeDeps.agentManager.getAgentAsync(prev.agentId);
    if (!prevAgent) {
      writeError(hooks, `Previous agent ${prev.agentId} no longer found.`);
      return;
    }

    const prevHistory = await loadSessionMessagesCommand.execute({
      sessionId: prev.sessionId,
      reason: 'back-nav',
      sink: hooks,
    });
    ctx.agent = prevAgent;
    ctx.sessionId = prev.sessionId;
    ctx.history = prevHistory;
    writeInfo(hooks, `\n← Returned to ${prevAgent.name} (${prevAgent.role})\n`);
  }
}
