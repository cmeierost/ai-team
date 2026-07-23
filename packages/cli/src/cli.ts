#!/usr/bin/env node
/**
 * AI Team CLI
 * Command-line interface for managing virtual AI development teams
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createContainerWithBootstrap, TOKENS } from '@ai-team/container';
import { findWorkspaceRoot } from '@ai-team/infrastructure';
import {
  type IServiceContainer,
  type ExecutionContext,
  type CliCommandMetadata,
  type ContainerTokenValue,
  CORE_SERVICE_TOKENS,
} from '@ai-team/core';

import { CliCommandClient } from './cli-command-client.js';
import {
  ChatRuntime,
  createChatRuntimeStepCommand,
  ServiceDomainError,
  type ChatRuntimeTurnInput,
  type ChatRuntimeStepResolver,
  type ServiceErrorInputRequest,
} from '@ai-team/service';
import { createQuestionResponders } from './handlers/question-responders.js';
import { runCommandStream } from './handlers/stream-runner.js';
import { registerCliResultHandlers } from './handlers/result-renderers.js';
import { createConsoleEmitService } from './emit/console-emit-service.js';
import type { ChatOptions } from '@ai-team/api-contracts';
import { CONTRACT_SERVICE_TOKENS } from '@ai-team/api-contracts';
import { renderChat } from './handlers/chat-new.js';
import { launchServer, launchServerWithUi } from './handlers/serve.js';
import { launchUi } from './handlers/ui.js';
import { requireSuccessfulHandoffTransition } from './chat-runtime-handoff-result.js';
import { resolveChatInvocationTarget } from './chat-invocation-target.js';
import {
  CLI_COMMAND_REGISTRY,
  getCliDispatchCommandKey,
  hasCliDispatchKey,
} from './handlers/registry.js';

const program = new Command();

const workspaceRoot = findWorkspaceRoot();

type CliCommandDispatcher = ContainerTokenValue<typeof CORE_SERVICE_TOKENS.CommandDispatcher>;
type CliWorkflowRunnerFactory = ContainerTokenValue<
  typeof CORE_SERVICE_TOKENS.WorkflowRunnerFactory
>;

class CliChatRuntimeBridge {
  constructor(
    private readonly commandDispatcher: CliCommandDispatcher,
    private readonly workflowRunnerFactory: CliWorkflowRunnerFactory
  ) {}

  async runAsync(input: Parameters<ChatRuntime['runAsync']>[0]) {
    const resolveStep: ChatRuntimeStepResolver = (step) => {
      switch (step) {
        case 'preturn':
          return createChatRuntimeStepCommand('preturn', async (_input: { message: string }) => ({
            outcome: 'continue' as const,
          }));
        case 'sendTurn':
          return createChatRuntimeStepCommand(
            'sendTurn',
            async (turnInput: ChatRuntimeTurnInput) => {
              const directHandoffTarget = this.extractDirectHandoffTargetQuery(
                turnInput.userMessage,
                turnInput.agentId
              );

              if (directHandoffTarget) {
                return {
                  text: '',
                  toolRoundNeeded: false,
                  handoffTargetId: directHandoffTarget,
                  handoffNote: `User explicitly requested to switch to ${directHandoffTarget}.`,
                  agentId: turnInput.agentId,
                  sessionId: turnInput.sessionId,
                };
              }

              const response = await this.commandDispatcher.dispatch(
                'chat-chat-direct-turn',
                {
                  agentId: turnInput.agentId,
                  options: {
                    message: turnInput.userMessage,
                    disableProcessExit: true,
                    messageOrigin: turnInput.options.messageOrigin,
                    sessionId: turnInput.sessionId,
                    createNewSession: turnInput.createNewSession,
                  },
                },
                (() => {
                  const signal = (input as { signal?: AbortSignal }).signal;
                  const depth = (input as { subworkflowDepth?: number }).subworkflowDepth;
                  return {
                    history: [],
                    agentId: turnInput.agentId,
                    sessionId: turnInput.sessionId,
                    invocationSurface: 'cli' as const,
                    calledByHuman: true,
                    callerType: 'human' as const,
                    ...(signal ? { signal } : {}),
                    ...(depth !== undefined ? { subworkflowDepth: depth } : {}),
                  };
                })()
              );

              if (response.status === 'error') {
                throw new Error(response.message || 'chat turn dispatch failed');
              }

              const payload =
                response.data && typeof response.data === 'object'
                  ? (response.data as {
                      text?: string;
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
                      agentId?: string;
                      sessionId?: string;
                    })
                  : undefined;

              return {
                text: typeof response.data === 'string' ? response.data : (payload?.text ?? ''),
                toolRoundNeeded: false,
                followUpMessage: payload?.followUpMessage,
                handoffTargetId: payload?.handoffTargetId,
                handoffTargetSessionId: payload?.handoffTargetSessionId,
                handoffNote: payload?.handoffNote,
                handoffTargetWorkflowId: payload?.handoffTargetWorkflowId,
                handoffWorkflowToolPolicy: payload?.handoffWorkflowToolPolicy,
                agentId: payload?.agentId,
                sessionId: payload?.sessionId,
              };
            }
          );
        case 'postTurnResolution':
          return createChatRuntimeStepCommand(
            'postTurnResolution',
            async (resolutionInput: {
              text: string;
              hop: number;
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
            }) => {
              if (resolutionInput.handoffTargetId) {
                return {
                  outcome: 'handoff_required' as const,
                  handoffTargetId: resolutionInput.handoffTargetId,
                  handoffTargetSessionId: resolutionInput.handoffTargetSessionId,
                  handoffNote: resolutionInput.handoffNote,
                  handoffTargetWorkflowId: resolutionInput.handoffTargetWorkflowId,
                  handoffWorkflowToolPolicy: resolutionInput.handoffWorkflowToolPolicy,
                };
              }

              return {
                outcome: 'normal_complete' as const,
              };
            }
          );
        case 'handoffTransition':
          return createChatRuntimeStepCommand(
            'handoffTransition',
            async (handoffInput: {
              handoff: {
                outcome: 'normal_complete' | 'handoff_required';
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
              };
              hop: number;
              fromAgentId?: string;
              fromSessionId?: string;
            }) => {
              if (handoffInput.handoff.outcome !== 'handoff_required') {
                return {};
              }

              const targetAgentId = handoffInput.handoff.handoffTargetId;
              if (!targetAgentId) {
                throw new Error('Handoff transition requested without handoffTargetId.');
              }

              const transition = await this.commandDispatcher.dispatch(
                'com-handoff',
                {
                  targetAgentId,
                  targetWorkflowId: handoffInput.handoff.handoffTargetWorkflowId ?? 'chat',
                  briefingNote: handoffInput.handoff.handoffNote,
                  workflowToolPolicy: handoffInput.handoff.handoffWorkflowToolPolicy,
                },
                (() => {
                  const signal = (input as { signal?: AbortSignal }).signal;
                  const depth = (input as { subworkflowDepth?: number }).subworkflowDepth;
                  return {
                    history: [],
                    agentId: handoffInput.fromAgentId,
                    sessionId: handoffInput.fromSessionId,
                    ...(signal ? { signal } : {}),
                    ...(depth !== undefined ? { subworkflowDepth: depth } : {}),
                  };
                })()
              );

              const data = requireSuccessfulHandoffTransition(transition);

              return {
                autoMessage: undefined,
                agentId: data?.targetAgentId ?? targetAgentId,
                sessionId: data?.targetSessionId ?? handoffInput.handoff.handoffTargetSessionId,
              };
            }
          );
        case 'toolRound':
          return undefined;
        case 'failure':
          return undefined;
        default:
          throw new Error(`Unsupported chat runtime step: ${String(step)}`);
      }
    };

    const runtime = new ChatRuntime(resolveStep, this.workflowRunnerFactory.create());

    return runtime.runAsync(input);
  }

  private extractDirectHandoffTargetQuery(
    userMessage: string,
    currentAgentId?: string
  ): string | undefined {
    const message = userMessage.trim();
    if (!message) {
      return undefined;
    }

    const patterns: RegExp[] = [
      /\b(?:let me talk to|talk to|switch to|hand\s*off to|handoff to|forward me to|route me to|transfer me to|connect me to)\s+([a-z0-9][a-z0-9\-_ ]*)$/i,
      /\b(?:i want to talk to|i need to talk to|i need to speak to|please switch me to|please connect me to)\s+([a-z0-9][a-z0-9\-_ ]*)$/i,
    ];

    let rawTarget: string | undefined;
    for (const pattern of patterns) {
      const match = pattern.exec(message);
      const candidate = match?.[1]?.trim();
      if (candidate) {
        rawTarget = candidate;
        break;
      }
    }

    if (!rawTarget) {
      return undefined;
    }

    const punctuation = new Set(['.', '!', '?', ';', ',', ':']);
    let normalizedSource = rawTarget.trim();

    while (
      normalizedSource.length > 0 &&
      ['"', "'", '`'].includes(normalizedSource.charAt(0) ?? '')
    ) {
      normalizedSource = normalizedSource.slice(1).trimStart();
    }

    while (normalizedSource.length > 0 && ['"', "'", '`'].includes(normalizedSource.at(-1) ?? '')) {
      normalizedSource = normalizedSource.slice(0, -1).trimEnd();
    }

    while (normalizedSource.length > 0 && punctuation.has(normalizedSource.at(-1) ?? '')) {
      normalizedSource = normalizedSource.slice(0, -1).trimEnd();
    }

    const normalized = normalizedSource.split(/\s+/).filter(Boolean).join('-').toLowerCase();

    if (!normalized || normalized === currentAgentId?.toLowerCase()) {
      return undefined;
    }

    // Avoid false positives on generic pronouns.
    if (['him', 'her', 'them', 'someone', 'anyone', 'another'].includes(normalized)) {
      return undefined;
    }

    // If the user asks for "the HR director" style phrasing, keep it as query text;
    // handoff command performs fuzzy resolution.
    return normalized;
  }
}

function registerCliChatRuntime(container: IServiceContainer): void {
  container.registerScoped(CORE_SERVICE_TOKENS.ChatRuntime, (c) => {
    const commandDispatcher = c.resolve(CORE_SERVICE_TOKENS.CommandDispatcher);
    const workflowRunnerFactory = c.resolve(CORE_SERVICE_TOKENS.WorkflowRunnerFactory);

    return new CliChatRuntimeBridge(commandDispatcher, workflowRunnerFactory);
  });
}

const cliQuestionService = createQuestionResponders();
const commandContainer = createContainerWithBootstrap({ workspaceRoot }, (c) => {
  c.registerInstance(TOKENS.QuestionService, cliQuestionService);
  // EmitService for the CLI — registered under both container and service-layer
  // tokens so both consumers can resolve it.
  const emitService = createConsoleEmitService();
  c.registerInstance(TOKENS.EmitService, emitService);
  c.registerInstance(CORE_SERVICE_TOKENS.EmitService, emitService);
  registerCliChatRuntime(c as unknown as IServiceContainer);
});
registerCliResultHandlers(commandContainer as unknown as IServiceContainer);
const commandClient = new CliCommandClient(
  commandContainer.resolve(CORE_SERVICE_TOKENS.CommandDispatcher),
  commandContainer.resolve(CORE_SERVICE_TOKENS.EmitService),
  commandContainer.resolve(TOKENS.BackendLogService),
  commandContainer.resolve(TOKENS.InteractionService)
);

type CliActionHandler = (...args: any[]) => Promise<unknown> | unknown;

interface ServiceCommandActionConfig {
  command: string;
  payload: (...args: unknown[]) => unknown;
  resultHandler?: (data: unknown, args: unknown[]) => void;
  useResultRegistry?: boolean;
  jsonSignature?: boolean;
}

interface CliApplicationDeps {
  program: Command;
  commandClient: CliCommandClient;
  commandContainer: IServiceContainer;
  workspaceRoot: string;
  metadataEntries: CliCommandMetadata[];
}

class CliApplication {
  constructor(private readonly deps: CliApplicationDeps) {}

  private async resolveChatStartupTarget(params: {
    agentId?: string;
    sessionId?: string;
    createNewSession: boolean;
  }): Promise<{ agentId?: string; agentName?: string; sessionId?: string }> {
    let resolvedAgentId = params.agentId?.trim() || undefined;
    let resolvedAgentName: string | undefined;
    let resolvedSessionId = params.sessionId;

    if (params.sessionId && !params.createNewSession) {
      try {
        const threadManager = this.deps.commandContainer.resolve(CORE_SERVICE_TOKENS.ThreadManager);
        const active = await threadManager.resolveActiveSession(params.sessionId);
        resolvedSessionId = active.session?.id ?? params.sessionId;
        resolvedAgentId = active.session?.agentId ?? resolvedAgentId;
      } catch {
        // The normal startup path below will report an unknown session.
      }
    }

    if (resolvedAgentId) {
      const agentManager = this.deps.commandContainer.resolve(CORE_SERVICE_TOKENS.AgentManager);
      const resolved = await agentManager.resolveAgentForOperationAsync(
        resolvedAgentId,
        'CLI chat startup'
      );
      resolvedAgentId = resolved.id;
      resolvedAgentName = resolved.name;
    }

    if (params.createNewSession || resolvedAgentId || params.sessionId) {
      return {
        agentId: resolvedAgentId,
        agentName: resolvedAgentName,
        sessionId: resolvedSessionId,
      };
    }

    try {
      const threadManager = this.deps.commandContainer.resolve(CORE_SERVICE_TOKENS.ThreadManager);

      const developerIdentityService = this.deps.commandContainer.resolve(
        CORE_SERVICE_TOKENS.DeveloperIdentityService
      );

      const developerName = developerIdentityService.getUserName() || 'developer';
      const developerId = developerIdentityService.toDeveloperId(developerName);
      const latest = await threadManager.resolveLatestActiveSession(developerId);

      if (!latest) {
        return { agentId: undefined, sessionId: undefined };
      }

      return {
        agentId: latest.agentId,
        agentName: undefined,
        sessionId: latest.id,
      };
    } catch {
      return {
        agentId: resolvedAgentId,
        agentName: resolvedAgentName,
        sessionId: resolvedSessionId,
      };
    }
  }

  public initialize(): void {
    this.deps.program
      .name('ait')
      .description('Manage virtual AI development teams')
      .version('0.1.0');

    this.registerDirectCliCommands(this.createDirectCliActionHandlers());

    // Default: running `ait` with no subcommand is an alias for `ait init`
    const initEntry = this.deps.metadataEntries.find((e) => e.key === 'init');
    if (initEntry) {
      this.deps.program.action(
        this.withCliErrorHandling(this.createDefaultRegistryAction(initEntry))
      );
    }

    this.deps.program.parse();
  }

  private formatInputRequestHint(
    request: ServiceErrorInputRequest | undefined
  ): string | undefined {
    if (!request) {
      return undefined;
    }

    if (request.kind === 'env-var') {
      return `Missing required value for ${request.key}.`;
    }

    return undefined;
  }

  private handleCliError(error: unknown): void {
    if (error instanceof ServiceDomainError) {
      const hint = this.formatInputRequestHint(error.inputRequest);
      console.error(chalk.red(error.message));
      if (hint) {
        console.error(chalk.dim(hint));
      }
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(message));
    process.exitCode = 1;
  }

  private withCliErrorHandling<TArgs extends unknown[]>(
    action: (...args: TArgs) => Promise<unknown> | unknown
  ): (...args: TArgs) => Promise<void> {
    return async (...args: TArgs) => {
      try {
        await action(...args);
      } catch (error) {
        this.handleCliError(error);
      }
    };
  }

  private applyCommandMetadata(command: Command, metadata: CliCommandMetadata): Command {
    command.description(metadata.description);

    const commandDeclaresArguments = /<[^>]+>|\[[^\]]+\]/.test(metadata.command);

    if (metadata.aliases) {
      for (const alias of metadata.aliases) {
        command.alias(alias);
      }
    }

    if (metadata.arguments && !commandDeclaresArguments) {
      for (const argument of metadata.arguments) {
        command.argument(argument.syntax, argument.description);
      }
    }

    if (metadata.options) {
      for (const option of metadata.options) {
        if (option.defaultValue !== undefined) {
          command.option(option.flags, option.description, option.defaultValue);
        } else {
          command.option(option.flags, option.description);
        }
      }
    }

    if (
      metadata.jsonSignature &&
      !metadata.options?.some((option) => /--json(?:\s|$)/.test(option.flags))
    ) {
      command.option('--json <payload>', 'JSON payload signature for command input');
    }

    return command;
  }

  private parseJsonPayload(raw: unknown): unknown | undefined {
    if (typeof raw !== 'string') {
      return undefined;
    }

    const trimmed = raw.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      return undefined;
    }

    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  private tryGetCommanderOptions(args: unknown[]): Record<string, unknown> | undefined {
    const commandArg = args.find((arg) => arg instanceof Command) as Command | undefined;
    if (commandArg) {
      return (commandArg.opts() as Record<string, unknown>) ?? undefined;
    }

    for (let i = args.length - 1; i >= 0; i -= 1) {
      const candidate = args[i];
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        return candidate as Record<string, unknown>;
      }
    }

    return undefined;
  }

  private toCliExecutionContext(args: unknown[]): ExecutionContext {
    const options = this.tryGetCommanderOptions(args) ?? {};
    const sessionId = options.sessionId ?? options.session ?? options['session-id'];
    const workflowId = options.workflowId ?? options['workflow-id'];
    const continuationToken =
      options.workflowContinuationToken ?? options['workflow-continuation-token'];

    const workflowState =
      typeof continuationToken === 'string' && continuationToken.trim().length > 0
        ? {
            workflowId: typeof workflowId === 'string' ? workflowId : '',
            continuationToken,
            answers: {},
          }
        : undefined;

    return {
      invocationSurface: 'cli',
      calledByHuman: true,
      history: [],
      sessionId:
        typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId : undefined,
      workflowId:
        typeof workflowId === 'string' && workflowId.trim().length > 0 ? workflowId : undefined,
      workflowState,
    };
  }

  private resolveServicePayload(config: ServiceCommandActionConfig, args: unknown[]): unknown {
    if (config.jsonSignature ?? true) {
      const options = this.tryGetCommanderOptions(args);
      const jsonOption = options?.json;

      if (typeof jsonOption === 'string') {
        const parsed = this.parseJsonPayload(jsonOption);
        if (parsed !== undefined) {
          return parsed;
        }
      }

      for (const arg of args) {
        const parsed = this.parseJsonPayload(arg);
        if (parsed !== undefined) {
          return parsed;
        }
      }
    }

    return config.payload(...args);
  }

  private toArgumentName(syntax: string): string {
    const match = /[<[]([^>\]]+)[>\]]/u.exec(syntax);
    if (!match?.[1]) {
      return 'value';
    }
    const raw = match[1].replace(/\.\.\.$/, '').trim() || 'value';
    // Convert kebab-case to camelCase so argument names match schema keys.
    return raw.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
  }

  private createGenericPayloadBuilder(entry: CliCommandMetadata): (...args: unknown[]) => unknown {
    return (...args: unknown[]) => {
      const options = this.tryGetCommanderOptions(args) ?? {};
      const positionals: string[] = [];

      for (const arg of args) {
        if (typeof arg === 'string') {
          positionals.push(arg);
        } else if (Array.isArray(arg) && arg.every((part) => typeof part === 'string')) {
          positionals.push(...arg);
        }
      }

      if (positionals.length === 0) {
        return options;
      }

      const payload: Record<string, unknown> = { ...options };
      const declaredArgs = entry.arguments ?? [];
      for (let i = 0; i < Math.min(positionals.length, declaredArgs.length); i += 1) {
        payload[this.toArgumentName(declaredArgs[i].syntax)] = positionals[i];
      }

      if (positionals.length > declaredArgs.length) {
        payload._ = positionals.slice(declaredArgs.length);
        payload.raw = positionals.slice(declaredArgs.length).join(' ');
      }

      if (declaredArgs.length === 0 && positionals.length === 1) {
        payload.value = positionals[0];
      }

      return payload;
    };
  }

  private createDefaultRegistryAction(entry: CliCommandMetadata): CliActionHandler {
    return this.createServiceCommandAction({
      command: getCliDispatchCommandKey(entry.key),
      payload: this.createGenericPayloadBuilder(entry),
      jsonSignature: entry.jsonSignature,
      useResultRegistry: true,
    });
  }

  private createServiceCommandAction(config: ServiceCommandActionConfig): CliActionHandler {
    return (...args: unknown[]) => {
      const executionContext = this.toCliExecutionContext(args);

      return runCommandStream(
        this.deps.commandClient,
        {
          command: config.command,
          payload: this.resolveServicePayload(config, args),
        },
        {
          resultHandler: config.resultHandler
            ? (data) => config.resultHandler?.(data, args)
            : undefined,
          serviceContainer: config.useResultRegistry ? this.deps.commandContainer : undefined,
          rendererOptions: config.useResultRegistry ? args[0] : undefined,
          executionContext,
        }
      );
    };
  }

  private getLocalHelpEntries(): Array<{
    key: string;
    description: string;
    availableIn: { cli: boolean };
  }> {
    return [
      {
        key: 'chat',
        description: 'Start a chat session with an agent',
        availableIn: { cli: true },
      },
      {
        key: 'serve',
        description: 'Start API server (production mode)',
        availableIn: { cli: true },
      },
      {
        key: 'serve ui',
        description: 'Start API server and launch UI',
        availableIn: { cli: true },
      },
      {
        key: 'ui',
        description: 'Start UI dev server (starts API server if needed)',
        availableIn: { cli: true },
      },
      {
        key: 'help [command...]',
        description: 'Show help (optionally for a command path)',
        availableIn: { cli: true },
      },
    ];
  }

  private createDirectCliActionHandlers(): Record<string, CliActionHandler> {
    const runChat = async (...args: unknown[]) => {
      const opts = this.tryGetCommanderOptions(args) ?? {};
      const positionals = args.filter((a): a is string => typeof a === 'string');
      const message = typeof opts.message === 'string' ? opts.message : undefined;
      const explicitSessionId = typeof opts.sessionId === 'string' ? opts.sessionId : undefined;
      const invocationTarget = resolveChatInvocationTarget(
        positionals,
        explicitSessionId,
        opts.new === true
      );
      const { agentId, sessionId, createNewSession } = invocationTarget;
      const rawMaxHops = opts.maxHops ?? opts['max-hops'];
      const parsedMaxHops =
        typeof rawMaxHops === 'number'
          ? rawMaxHops
          : typeof rawMaxHops === 'string'
            ? Number.parseInt(rawMaxHops, 10)
            : undefined;
      const maxHops = Number.isFinite(parsedMaxHops) ? parsedMaxHops : undefined;
      const autoReactMessage =
        typeof opts.autoReactMessage === 'string'
          ? opts.autoReactMessage
          : typeof opts['auto-react-message'] === 'string'
            ? opts['auto-react-message']
            : undefined;
      const startupTarget = await this.resolveChatStartupTarget({
        agentId,
        sessionId,
        createNewSession,
      });
      const resolvedAgentId = startupTarget.agentId;
      const resolvedAgentName = startupTarget.agentName;
      const resolvedSessionId = startupTarget.sessionId;

      const chatOptions: ChatOptions = {
        message,
        oneShot: message !== undefined,
        sessionId: resolvedSessionId,
        createNewSession,
      };

      const slashSuggestions = await (async () => {
        try {
          const commandsService = this.deps.commandContainer.resolve(
            CONTRACT_SERVICE_TOKENS.CommandsService
          );
          return await commandsService.list();
        } catch {
          return undefined;
        }
      })();

      return renderChat(
        this.deps.commandClient,
        resolvedAgentId,
        chatOptions,
        opts.mediatorLog === true,
        undefined,
        'chat-chat',
        {
          agentId: resolvedAgentId,
          agentName: resolvedAgentName,
          sessionId: resolvedSessionId,
          createNewSession,
          message,
          maxHops,
          autoReactMessage,
          ...(slashSuggestions ? { __slashSuggestions: slashSuggestions } : {}),
        },
        { questionService: cliQuestionService }
      );
    };

    return {
      chat: runChat,
      serve: (options) => launchServer(options, this.deps.workspaceRoot),
      'serve.ui': (options) => launchServerWithUi(options, this.deps.workspaceRoot),
      ui: (options) => launchUi(options, this.deps.workspaceRoot),
      help: (commandPath: unknown) => {
        let parts: string[];
        if (Array.isArray(commandPath)) {
          parts = (commandPath as string[]).filter(Boolean);
        } else if (typeof commandPath === 'string' && commandPath) {
          parts = [commandPath];
        } else {
          parts = [];
        }

        const localExtras = this.getLocalHelpEntries();

        if (parts.length === 0) {
          return runCommandStream(
            this.deps.commandClient,
            { command: 'system-help', payload: JSON.stringify({ extra: localExtras }) },
            { executionContext: this.toCliExecutionContext([]) }
          );
        }

        // Route through service to get Zod parameter descriptions.
        // Pass localExtras so local-only entries (chat, serve, ui) are also findable.
        return runCommandStream(
          this.deps.commandClient,
          {
            command: 'system-help',
            payload: JSON.stringify({ filter: parts.join(' '), extra: localExtras }),
          },
          { executionContext: this.toCliExecutionContext([]) }
        );
      },
    };
  }

  private registerDirectCliCommands(actionHandlers: Record<string, CliActionHandler>): void {
    const directEntries = this.deps.metadataEntries.filter((entry) => entry.directCli);
    const entriesByKey = new Map(directEntries.map((entry) => [entry.key, entry]));
    const registeredCommands = new Map<string, Command>();

    const registerEntry = (entry: CliCommandMetadata): Command => {
      const existing = registeredCommands.get(entry.key);
      if (existing) {
        return existing;
      }

      const parentCommand = entry.parentKey
        ? registerEntry(
            entriesByKey.get(entry.parentKey) ??
              (() => {
                throw new Error(`Direct CLI parent metadata missing for '${entry.key}'.`);
              })()
          )
        : this.deps.program;

      const command = this.applyCommandMetadata(parentCommand.command(entry.command), entry);
      registeredCommands.set(entry.key, command);

      const actionHandler =
        actionHandlers[entry.key] ??
        (hasCliDispatchKey(entry.key) ? this.createDefaultRegistryAction(entry) : undefined);
      if (!actionHandler) {
        // Keep non-callable grouping commands (e.g. provider, access) action-less
        // so Commander naturally routes to subcommands/help without dispatching.
        return command;
      }

      command.action(this.withCliErrorHandling(actionHandler));
      return command;
    };

    for (const entry of directEntries) {
      registerEntry(entry);
    }
  }
}

new CliApplication({
  program,
  commandClient,
  commandContainer: commandContainer as unknown as IServiceContainer,
  workspaceRoot,
  metadataEntries: CLI_COMMAND_REGISTRY,
}).initialize();
