#!/usr/bin/env node
/**
 * AI Team CLI
 * Command-line interface for managing virtual AI development teams
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createContainerWithBootstrap, TOKENS } from '@ai-team/container';
import type { IServiceContainer, ExecutionContext, CliCommandMetadata } from '@ai-team/core';
import { registerCliCommandCatalog } from '@ai-team/infrastructure';
import { CliCommandClient } from './cli-command-client.js';
import {
  findWorkspaceRoot,
  ServiceDomainError,
  type ServiceErrorInputRequest,
} from '@ai-team/service';
import { createQuestionResponders } from './handlers/question-responders.js';
import { runCommandStream } from './handlers/stream-runner.js';
import { registerCliResultHandlers } from './handlers/result-renderers.js';
import type { ChatOptions } from '@ai-team/api-contracts';
import { renderChat } from './handlers/chat.js';
import { launchServer, launchServerWithUi } from './handlers/serve.js';
import { launchUi } from './handlers/ui.js';
import {
  CLI_COMMAND_REGISTRY,
  getCliDispatchCommandKey,
  hasCliDispatchKey,
} from './handlers/registry.js';

registerCliCommandCatalog(CLI_COMMAND_REGISTRY);

const program = new Command();

function formatInputRequestHint(request: ServiceErrorInputRequest | undefined): string | undefined {
  if (!request) {
    return undefined;
  }

  if (request.kind === 'env-var') {
    return `Missing required value for ${request.key}.`;
  }

  return undefined;
}

function handleCliError(error: unknown): void {
  if (error instanceof ServiceDomainError) {
    const hint = formatInputRequestHint(error.inputRequest);
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

function withCliErrorHandling<TArgs extends unknown[]>(
  action: (...args: TArgs) => Promise<unknown> | unknown
): (...args: TArgs) => Promise<void> {
  return async (...args: TArgs) => {
    try {
      await action(...args);
    } catch (error) {
      handleCliError(error);
    }
  };
}

function applyCommandMetadata(command: Command, metadata: CliCommandMetadata): Command {
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

const workspaceRoot = findWorkspaceRoot();

const commandContainer = createContainerWithBootstrap({ workspaceRoot }, (c) => {
  c.registerInstance(TOKENS.QuestionService, createQuestionResponders());
});
registerCliResultHandlers(commandContainer as unknown as IServiceContainer);
const commandClient = new CliCommandClient(
  workspaceRoot,
  commandContainer.child() as unknown as IServiceContainer
);

type CliActionHandler = (...args: any[]) => Promise<unknown> | unknown;

interface ServiceCommandActionConfig {
  command: string;
  payload: (...args: unknown[]) => unknown;
  resultHandler?: (data: unknown, args: unknown[]) => void;
  useResultRegistry?: boolean;
  jsonSignature?: boolean;
}

function parseJsonPayload(raw: unknown): unknown | undefined {
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

function tryGetCommanderOptions(args: unknown[]): Record<string, unknown> | undefined {
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

function toCliExecutionContext(args: unknown[]): ExecutionContext {
  const options = tryGetCommanderOptions(args) ?? {};
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
    workspaceRoot,
    invocationSurface: 'cli',
    calledByHuman: true,
    history: [],
    sessionId: typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId : undefined,
    workflowId:
      typeof workflowId === 'string' && workflowId.trim().length > 0 ? workflowId : undefined,
    workflowState,
  };
}

function resolveServicePayload(config: ServiceCommandActionConfig, args: unknown[]): unknown {
  if (config.jsonSignature ?? true) {
    const options = tryGetCommanderOptions(args);
    const jsonOption = options?.json;

    if (typeof jsonOption === 'string') {
      const parsed = parseJsonPayload(jsonOption);
      if (parsed !== undefined) {
        return parsed;
      }
    }

    for (const arg of args) {
      const parsed = parseJsonPayload(arg);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }

  return config.payload(...args);
}

function toArgumentName(syntax: string): string {
  const match = /[<[]([^>\]]+)[>\]]/u.exec(syntax);
  if (!match?.[1]) {
    return 'value';
  }
  const raw = match[1].replace(/\.\.\.$/, '').trim() || 'value';
  // Convert kebab-case to camelCase so argument names match schema keys.
  return raw.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function createGenericPayloadBuilder(entry: CliCommandMetadata): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const options = tryGetCommanderOptions(args) ?? {};
    const positionals: string[] = [];

    for (const arg of args) {
      if (typeof arg === 'string') {
        positionals.push(arg);
      } else if (Array.isArray(arg) && arg.every((part) => typeof part === 'string')) {
        positionals.push(...(arg as string[]));
      }
    }

    if (positionals.length === 0) {
      return options;
    }

    const payload: Record<string, unknown> = { ...options };
    const declaredArgs = entry.arguments ?? [];
    for (let i = 0; i < Math.min(positionals.length, declaredArgs.length); i += 1) {
      payload[toArgumentName(declaredArgs[i].syntax)] = positionals[i];
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

function createDefaultRegistryAction(entry: CliCommandMetadata): CliActionHandler {
  return createServiceCommandAction({
    command: getCliDispatchCommandKey(entry.key),
    payload: createGenericPayloadBuilder(entry),
    jsonSignature: entry.jsonSignature,
    useResultRegistry: true,
  });
}

function createServiceCommandAction(config: ServiceCommandActionConfig): CliActionHandler {
  return (...args: unknown[]) => {
    const executionContext = toCliExecutionContext(args);

    return runCommandStream(
      commandClient,
      {
        command: config.command,
        payload: resolveServicePayload(config, args),
      },
      {
        resultHandler: config.resultHandler
          ? (data) => config.resultHandler?.(data, args)
          : undefined,
        serviceContainer: config.useResultRegistry
          ? (commandContainer as unknown as IServiceContainer)
          : undefined,
        rendererOptions: config.useResultRegistry ? args[0] : undefined,
        executionContext,
      }
    );
  };
}

const directCliActionHandlers: Record<string, CliActionHandler> = {
  chat: (...args: unknown[]) => {
    const opts = tryGetCommanderOptions(args) ?? {};
    const agentId = args.find((a) => typeof a === 'string') as string | undefined;
    const message = typeof opts.message === 'string' ? opts.message : undefined;
    const chatOptions: ChatOptions = {
      message,
      oneShot: message !== undefined,
      sessionId: typeof opts.sessionId === 'string' ? opts.sessionId : undefined,
      createNewSession: opts.new === true,
    };
    return renderChat(commandClient, agentId, chatOptions, opts.mediatorLog === true);
  },
  serve: (options) => launchServer(options, workspaceRoot),
  'serve.ui': (options) => launchServerWithUi(options, workspaceRoot),
  ui: (options) => launchUi(options, workspaceRoot),
  help: (commandPath: unknown) => {
    let parts: string[];
    if (Array.isArray(commandPath)) {
      parts = (commandPath as string[]).filter(Boolean);
    } else if (typeof commandPath === 'string' && commandPath) {
      parts = [commandPath];
    } else {
      parts = [];
    }

    const localExtras: Array<{
      key: string;
      description: string;
      availableIn: { cli: boolean };
    }> = [
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

    if (parts.length === 0) {
      return runCommandStream(
        commandClient,
        { command: 'system-help', payload: JSON.stringify({ extra: localExtras }) },
        { executionContext: toCliExecutionContext([]) }
      );
    }

    // Route through service to get Zod parameter descriptions.
    // Pass localExtras so local-only entries (chat, serve, ui) are also findable.
    return runCommandStream(
      commandClient,
      {
        command: 'system-help',
        payload: JSON.stringify({ filter: parts.join(' '), extra: localExtras }),
      },
      { executionContext: toCliExecutionContext([]) }
    );
  },
};

function registerDirectCliCommands(
  rootCommand: Command,
  metadataEntries: CliCommandMetadata[],
  actionHandlers: Record<string, CliActionHandler>
): void {
  const directEntries = metadataEntries.filter((entry) => entry.directCli);
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
      : rootCommand;

    const command = applyCommandMetadata(parentCommand.command(entry.command), entry);
    registeredCommands.set(entry.key, command);

    const actionHandler =
      actionHandlers[entry.key] ??
      (hasCliDispatchKey(entry.key) ? createDefaultRegistryAction(entry) : undefined);
    if (!actionHandler) {
      // Keep non-callable grouping commands (e.g. provider, access) action-less
      // so Commander naturally routes to subcommands/help without dispatching.
      return command;
    }

    command.action(withCliErrorHandling(actionHandler));
    return command;
  };

  for (const entry of directEntries) {
    registerEntry(entry);
  }
}

program.name('ait').description('Manage virtual AI development teams').version('0.1.0');
registerDirectCliCommands(program, CLI_COMMAND_REGISTRY, directCliActionHandlers);

// Default: running `ait` with no subcommand is an alias for `ait init`
const initEntry = CLI_COMMAND_REGISTRY.find((e) => e.key === 'init');
if (initEntry) {
  program.action(withCliErrorHandling(createDefaultRegistryAction(initEntry)));
}

program.parse();
