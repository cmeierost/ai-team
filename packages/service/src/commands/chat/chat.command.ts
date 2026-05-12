import ora from 'ora';
import type {
  ChatMessage,
  Agent,
  IAgentManager,
  ICommand,
  ICommandRegistry,
  IServiceContainer,
  IConfigurationStorage,
  IEnvironmentStorage,
  IDeveloperIdentityService,
  IAgentDocumentStorage,
  ExecutionContext,
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
import { createToolManager } from '../../tools/create-tool-manager.js';
import type { ToolManager } from '../../tools/tool-manager.js';
import type { PathPermissionCheckerLike } from '../../tools/create-tool-manager.js';
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
import { ToolDispatcher } from '../../orchestrator/tool-dispatch.js';
import { HandoffOrchestrator } from '../../orchestrator/handoff.js';
import { WorkflowIntentProvider } from '../../tools/workflow-intent-provider.js';
import type { ChatRuntimeHooks } from '../../orchestrator/hooks.js';
import {
  withTimeout,
  withAbortSignal,
  isAbortError,
  throwIfAborted,
} from '../../utils/async-utils.js';
import { requestInput } from '../com/questions.js';
import { formatUserPrompt } from '../../utils/agent-selection.js';
import type { IChatInfoService } from '../../orchestrator/chat-info-service.js';
import type { IChatPreflightService } from '../../orchestrator/chat-preflight-service.js';
import { ResolveChatSessionCommand } from './resolve-chat-session.command.js';
import { LoadSessionMessagesCommand } from './load-session-messages.command.js';
import { runChatSessionStartupWorkflow } from './chat-session-startup.workflow.js';
import { buildChatSlashCommands } from './build-chat-slash-commands.js';

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
  pathPermissionChecker: PathPermissionCheckerLike;
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
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const sessionManager = this.sessionExecutionDeps.sessionManager;
    const agentManager = this.agentKnowledgeDeps.agentManager;
    const { configurationStorage, developerIdentityService } = this.configIdentityDeps;
    const { agentDocumentStorage, markdownSectionService, skillManager } = this.agentKnowledgeDeps;
    const { llmService, proposalStoreFactory } = this.sessionExecutionDeps;
    const { pathPermissionChecker, serviceContainer } = this.orchestrationDeps;

    // Note: process.stdout.write is already patched by the invoke() wrapper in
    // AiTeamService when context.emit is present. Do NOT add a second patch here
    // — that would cause every token and log line to be emitted (and printed)
    // twice in the CLI. console.log/warn/error are safe to override because they
    // go through emitRuntimeEvent → hooks.emit into the same queue, but stdout
    // must only be patched once at the invoke level.
    if (hooks.emit) {
      console.log = (...args: unknown[]) =>
        emitRuntimeEvent(hooks, { kind: 'log', level: 'info', message: formatConsoleArgs(args) });
      console.warn = (...args: unknown[]) =>
        emitRuntimeEvent(hooks, { kind: 'log', level: 'warn', message: formatConsoleArgs(args) });
      console.error = (...args: unknown[]) =>
        emitRuntimeEvent(hooks, { kind: 'log', level: 'error', message: formatConsoleArgs(args) });
    }

    let currentSessionId!: string;

    try {
      // Navigation stack for /back — each entry is the session we came FROM
      const navStack: Array<{ agentId: string; sessionId: string; agentName: string }> = [];

      const { developerName } = await this.preflightService.resolve(workspaceRoot, hooks);
      const resolveChatSessionCommand = new ResolveChatSessionCommand(
        sessionManager as Pick<SessionManager, 'createSession' | 'getLatestSession'>,
        developerIdentityService as Pick<IDeveloperIdentityService, 'toDeveloperId'>
      );
      const loadSessionMessagesCommand = new LoadSessionMessagesCommand(
        sessionManager as Pick<SessionManager, 'getSessionMessages'>
      );

      const resolveCtx: ExecutionContext = {
        workspaceRoot,
        history: [],
        signal: hooks.signal,
        emit: hooks.emit as ExecutionContext['emit'],
        questionSelect: hooks.questionSelect as ExecutionContext['questionSelect'],
        invocationSurface: hooks.invocationSurface,
      };
      const agentResolution = await this.agentResolutionService.execute(agentId ?? '', resolveCtx);
      if (agentResolution.status === 'error') throw new Error(agentResolution.message);
      const resolvedAgent = agentResolution.data?.[0];
      if (!resolvedAgent) {
        throw new Error(`No agent found for '${agentId ?? 'default selection'}'.`);
      }
      let agent: Agent = resolvedAgent;

      // Initialize LLM service
      const llm = llmService;
      if (!llm) throw new Error('ChatCommand: llmService is required but was not provided');
      wireLlmDiagnostics(llm as ILlmService, hooks);
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
        sessionManager.setAutoTitleLlmService(llm as ILlmService);
      } catch (error) {
        if (spinner) spinner.fail('Could not connect to configured LLM');
        writeError(hooks, (error as Error).message);
        writeInfo(
          hooks,
          'Run "ait test-connection" to debug, or "ait init" to configure provider.'
        );
        throw new Error((error as Error).message);
      }

      // Load skill instructions for the agent's role
      let skill;
      try {
        skill = await agentDocumentStorage.loadSkillAsync(agent.skillPath);
        writeInfo(hooks, `Loaded skill: ${skill.name} (${agent.skillPath})`);
      } catch {
        writeInfo(hooks, `No skill file found for ${agent.role}, using agent portfolio only`);
      }

      // Load workspace instruction files
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
      this.chatInfoService.showSessionIntro({
        sink: hooks,
        agent,
        developerName,
        workflowMode: options.workflowMode,
        workflowExitWords: options.workflowExitWords,
      });

      // Load chat history
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
        {
          signal: hooks.signal,
        }
      );
      currentSessionId = startup.sessionId;
      let history = startup.history;
      this.chatInfoService.showSessionResume(history, agent.name, developerName, hooks);

      // Agent introduces themselves on first contact
      if (
        history.length === 0 &&
        !options.pendingIntroduction &&
        !options.suppressAutoIntroduction
      ) {
        await tryIntroduceUserNew({
          agentManager: agentManager as IAgentManager,
          markdownSectionService: markdownSectionService as IMarkdownSectionService,
          agent,
          history,
          developerName,
          sessionManager: sessionManager as SessionManager,
          sessionId: currentSessionId,
          hooks,
        });
      }

      // Persist a web-client-generated introduction (keeps history ordering correct)
      if (options.pendingIntroduction && history.length === 0) {
        const introMsg: ChatMessage = {
          timestamp: new Date().toISOString(),
          from: agent.id,
          to: 'human',
          content: options.pendingIntroduction,
          importance: 'low',
        };
        if (sessionManager && currentSessionId) {
          await sessionManager.appendMessage(currentSessionId, introMsg);
        }
        history.push(introMsg);
      }

      // ── Build ExecutionContext + ChatOrchestrator ─────────────────────────
      const chatToolManager: ToolManager = createToolManager(workspaceRoot, {
        pathPermissionChecker,
        container: serviceContainer,
        agentManagementDeps: {
          configurationStorage: configurationStorage as IConfigurationStorage,
          agentManager: agentManager as IAgentManager,
          agentDocumentStorage: agentDocumentStorage as IAgentDocumentStorage,
        },
      });

      const _toolDispatcher = new ToolDispatcher(
        chatToolManager,
        sessionManager as SessionManager,
        llm as ILlmService,
        proposalStoreFactory
      );

      // Create ctx first so slash commands reference it as their mutable SessionSnapshot
      const _ctx: ExecutionContext = {
        agent,
        workspaceRoot,
        sessionId: currentSessionId,
        hooks,
        toolManager: chatToolManager,
        sessionManager: sessionManager as SessionManager,
        agentManager: agentManager as IAgentManager,
        skillManager,
        llmService: llm as any,
        toolDispatcher: _toolDispatcher,
        history,
        instructions,
      };
      const slashCommands = await buildChatSlashCommands({
        workspaceRoot,
        chatToolManager: chatToolManager as unknown as ICommandRegistry,
        skillManager,
        configurationStorage,
        serviceContainer,
        hooks,
        currentSessionId,
        executionContext: _ctx,
      });

      const _plugins: ResolvedPlugins = {
        compressor: new NoOpCompressor(),
        contextBuilder: new DefaultContextBuilder(),
        enrichers: [
          new WorkspaceOverviewEnricher(),
          new TeamRosterEnricher(agentManager as IAgentManager),
        ],
        ragProvider: new NoOpRagProvider(),
        toolResolver: new DefaultToolResolver(chatToolManager),
        mcpGateway: new NoOpMcpGateway(),
        llmSelector: new DefaultLlmSelector(llm as ILlmService),
        outputHandler: new DefaultOutputHandler(),
        slashCommands,
        turnResultParsers: buildDefaultTurnResultParsers(agentManager as IAgentManager),
        hookPlugins: buildDefaultHookPlugins(),
        preLlmIntentProviders: [new WorkflowIntentProvider()],
      };

      const _handoffOrchestrator = new HandoffOrchestrator(
        agentManager as IAgentManager,
        sessionManager as SessionManager,
        llm as ILlmService
      );
      const _orchestrator = new XStateChatOrchestrator(
        _ctx,
        _plugins,
        (_ctx as any).toolDispatcher as ToolDispatcher,
        _handoffOrchestrator,
        hooks,
        agentManager as IAgentManager,
        sessionManager as SessionManager,
        llm as ILlmService
      );

      // Single message mode
      if (options.message) {
        const trimmedMessage = options.message.trim();
        await withAbortSignal(
          _orchestrator.run({ message: trimmedMessage, contextFiles: options.context }),
          hooks.signal,
          'Chat request aborted by user.'
        );
        if (options.oneShot) return;
      }

      // Interactive chat loop — CLI only; exit if no terminal input hook is available
      if (!hooks.questionInput) return;
      while (true) {
        throwIfAborted(hooks.signal, 'Chat request aborted by user.');

        const message = await withAbortSignal(
          requestInput(hooks, {
            message: formatUserPrompt(agent, developerName),
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

        // /back — handled here so it has access to the local navStack
        if (message.trim() === '/back') {
          if (navStack.length === 0) {
            writeWarn(hooks, 'No previous agent to return to.');
            writeInfo(hooks, '');
          } else {
            const prev = navStack.pop()!;
            const prevAgent = await agentManager.getAgentAsync(prev.agentId);
            if (prevAgent) {
              const prevHistory = await loadSessionMessagesCommand.execute({
                sessionId: prev.sessionId,
                reason: 'back-nav',
                sink: hooks,
              });
              (_ctx as any).agent = prevAgent;
              agent = prevAgent;
              (_ctx as any).sessionId = prev.sessionId;
              (_ctx as any).history = prevHistory;
              writeInfo(hooks, `\n← Returned to ${prevAgent.name} (${prevAgent.role})\n`);
            } else {
              writeError(hooks, `Previous agent ${prev.agentId} no longer found.`);
            }
          }
          continue;
        }

        // Slash turn — explicitly forward to slash handler path in orchestrator
        if (message.trim().startsWith('/')) {
          await withAbortSignal(
            _orchestrator.run({ message, contextFiles: options.context }),
            hooks.signal,
            'Chat request aborted by user.'
          );
          continue;
        }

        // Regular turn — delegate to ChatOrchestrator
        const prevAgentId = agent.id;
        const prevSessionId = _ctx.sessionId ?? currentSessionId;
        await withAbortSignal(
          _orchestrator.run({ message, contextFiles: options.context }),
          hooks.signal,
          'Chat request aborted by user.'
        );
        if (agent.id !== prevAgentId) {
          navStack.push({ agentId: prevAgentId, sessionId: prevSessionId, agentName: prevAgentId });
        }
      }
    } catch (error) {
      if (isAbortError(error)) {
        writeInfo(hooks, 'Chat aborted.');
        return;
      }
      writeError(hooks, `Error in chat: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(error instanceof Error ? error.message : String(error));
    } finally {
      if (sessionManager) {
        try {
          await sessionManager.close();
        } catch {}
      }
      if (hooks.emit) {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
      }
    }
  }
}
