#!/usr/bin/env node
/**
 * AI Team CLI
 * Command-line interface for managing virtual AI development teams
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createContainerWithBootstrap, TOKENS } from '@ai-team/container';
import type { IServiceContainer } from '@ai-team/core';
import { InteractionQuestionService } from '@ai-team/service';
import { createQuestionResponders } from './handlers/question-responders.js';
import type { InteractionContext } from '@ai-team/api-contracts';
import type { CliCommandMetadata } from '@ai-team/core';
import { registerCliCommandCatalog } from '@ai-team/infrastructure';
import { CliCommandClient } from './cli-command-client.js';
import {
  findWorkspaceRoot,
  ServiceDomainError,
  type ServiceErrorInputRequest,
} from '@ai-team/service';
import { renderInit } from './handlers/init.js';
import { renderAgentList } from './handlers/list.js';

import { renderChat } from './handlers/chat.js';
import { renderTeamGraph } from './handlers/graph.js';

import { renderAgentInfo } from './handlers/info.js';

import { renderSysinfo } from './handlers/sysinfo.js';

import {
  renderCodeEditList,
  renderCodeEditApprove,
  renderCodeEditReject,
  renderCodeEditApply,
} from './handlers/code-edit.js';

import { renderPatchApply } from './handlers/patch.js';
import {
  renderFilesTree,
  renderFilesPatterns,
  renderFilesAllow,
  renderFilesDeny,
} from './handlers/files.js';
import { runCommandStream } from './handlers/stream-runner.js';
import { registerCliResultHandlers } from './handlers/result-renderers.js';
import { renderToolsAllow, renderToolsList, renderToolsDeny } from './handlers/tools.js';
import { renderSkillsList, renderSkillsAdd, renderSkillsRemove } from './handlers/skills.js';
import { renderSearchResults } from './handlers/search.js';

import {
  renderProviderAdd,
  renderProviderConfigure,
  renderProviderSet,
} from './handlers/provider.js';

import { renderOrgGraph } from './handlers/org.js';
import { launchServer, launchServerWithUi } from './handlers/serve.js';
import { launchUi } from './handlers/ui.js';
import { CLI_COMMAND_REGISTRY, getCliDispatchCommandKey } from './handlers/registry.js';
import { renderDbStatus, renderDbMigrate } from './handlers/db.js';

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
  c.registerInstance(TOKENS.QuestionService, InteractionQuestionService(createQuestionResponders()));
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

function toCliInteractionContext(args: unknown[]): InteractionContext {
  const options = tryGetCommanderOptions(args) ?? {};
  const context: InteractionContext = {
    ...(options as Record<string, unknown>),
  } as InteractionContext;

  (context as any).invocationSurface = 'cli';
  (context as any).calledByHuman = true;

  const sessionId =
    options.sessionId ?? options.session ?? options['session-id'];
  if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
    (context as any).sessionId = sessionId;
  }

  const workflowId = options.workflowId ?? options['workflow-id'];
  if (typeof workflowId === 'string' && workflowId.trim().length > 0) {
    (context as any).workflowId = workflowId;
  }

  const continuationToken =
    options.workflowContinuationToken ?? options['workflow-continuation-token'];
  if (typeof continuationToken === 'string' && continuationToken.trim().length > 0) {
    (context as any).workflowState = {
      workflowId: typeof workflowId === 'string' ? workflowId : '',
      continuationToken,
      answers: {},
    };
  }

  return context;
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
  const match = syntax.match(/[<\[]([^>\]]+)[>\]]/);
  if (!match?.[1]) {
    return 'value';
  }
  return match[1].replace(/\.\.\.$/, '').trim() || 'value';
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
    const interactionContext = toCliInteractionContext(args);

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
        interactionContext,
      }
    );
  };
}

const directCliActionHandlers: Record<string, CliActionHandler> = {
  init: (options) => renderInit(commandClient, options),
  list: createServiceCommandAction({
    command: 'listEmployees',
    payload: (options) => {
      const typed = (options ?? {}) as { role?: string; feature?: string };
      return { role: typed.role, feature: typed.feature };
    },
    resultHandler: (data, args) =>
      renderAgentList(data as any, (args[0] ?? {}) as { role?: string; feature?: string; json?: boolean }),
  }),
  create: createServiceCommandAction({
    command: 'create',
    payload: (type, options) => ({ type: String(type).toLowerCase(), options }),
  }),
  chat: (...rawArgs: unknown[]) => {
    let agentId: string | undefined;
    let messageParts: string[] | undefined;
    let options: {
      message?: string;
      context?: string[];
      mediatorLog?: boolean;
      new?: boolean;
      session?: string;
    } = {};

    for (const arg of rawArgs) {
      if (typeof arg === 'string') {
        if (!agentId) {
          agentId = arg;
        }
        continue;
      }

      if (Array.isArray(arg) && arg.every((part) => typeof part === 'string')) {
        messageParts = arg as string[];
        continue;
      }

      if (arg instanceof Command) {
        options = { ...options, ...(arg.opts() as typeof options) };
        continue;
      }

      if (arg && typeof arg === 'object') {
        options = { ...options, ...(arg as Partial<typeof options>) };
      }
    }

    const { mediatorLog, new: createNew, session, ...chatOptions } = options;
    const inlineMessage =
      messageParts && messageParts.length > 0 ? messageParts.join(' ') : undefined;
    const hasOptionMessage = Boolean(chatOptions.message || inlineMessage);
    const message = chatOptions.message || inlineMessage;
    return renderChat(
      commandClient,
      agentId,
      {
        ...chatOptions,
        message,
        oneShot: hasOptionMessage,
        createNewSession: createNew,
        sessionId: session,
      },
      Boolean(mediatorLog)
    );
  },
  graph: async (options: { mode?: string; output?: string }) => {
    let graphData: unknown;
    await runCommandStream(
      commandClient,
      {
        command: 'getTeamGraph',
        payload: { mode: options.mode as any },
      },
      {
        resultHandler: (data) => {
          graphData = data;
        },
      }
    );

    if (!graphData) {
      return;
    }

    if (options.output) {
      const fs = await import('fs/promises');
      if (options.output.endsWith('.json')) {
        await fs.writeFile(options.output, JSON.stringify(graphData, null, 2));
        console.log(chalk.green(`✓ Exported graph to ${options.output}`));
      } else {
        console.log(chalk.yellow('Only JSON export is currently supported'));
        console.log(chalk.dim('Use --output graph.json'));
      }
      return;
    }

    await renderTeamGraph(graphData as Parameters<typeof renderTeamGraph>[0], {
      mode: options.mode,
    });
  },
  org: createServiceCommandAction({
    command: 'getOrganizationGraph',
    payload: () => ({}),
    resultHandler: (data, args) =>
      renderOrgGraph(data as any, (args[0] ?? {}) as { mermaid?: boolean; output?: string }),
  }),
  hire: createServiceCommandAction({
    command: 'hire',
    payload: (options) => options ?? {},
  }),
  info: createServiceCommandAction({
    command: 'resolveEmployees',
    payload: (agentId, options) => ({
      query: String(agentId),
      json: (options as { json?: boolean } | undefined)?.json,
    }),
    resultHandler: (data, args) =>
      renderAgentInfo(data as any, String(args[0]), (args[1] ?? {}) as { json?: boolean }),
  }),
  fire: createServiceCommandAction({
    command: 'fire',
    payload: (agentQuery, options) => ({
      employeeQuery: String(agentQuery),
      options: options ?? {},
    }),
  }),
  show: createServiceCommandAction({
    command: 'resolveEmployees',
    payload: (agentId) => ({ query: String(agentId) }),
    resultHandler: (data, args) =>
      renderAgentInfo(data as any, String(args[0]), { openAvatar: true, workspaceRoot }),
  }),
  avatar: createServiceCommandAction({
    command: 'avatar',
    payload: (agentQuery) => ({ agentQuery: String(agentQuery) }),
  }),
  sysinfo: createServiceCommandAction({
    command: 'systemInfo',
    payload: (options) => ({ json: (options as { json?: boolean } | undefined)?.json }),
    resultHandler: (data, args) => renderSysinfo(data as any, (args[0] ?? {}) as { json?: boolean }),
  }),
  'code-edit': (options: {
    status?: string;
    agent?: string;
    json?: boolean;
    approve?: string;
    reject?: string;
    apply?: string;
  }) => {
    if (options.approve) {
      return runCommandStream(
        commandClient,
        {
          command: 'codeEditApprove',
          payload: { proposalId: options.approve },
        },
        {
          resultHandler: (data) => renderCodeEditApprove(data as any),
        }
      );
    }
    if (options.reject) {
      return runCommandStream(
        commandClient,
        {
          command: 'codeEditReject',
          payload: { proposalId: options.reject },
        },
        {
          resultHandler: (data) => renderCodeEditReject(data as any),
        }
      );
    }
    if (options.apply) {
      return runCommandStream(
        commandClient,
        {
          command: 'codeEditApply',
          payload: { proposalId: options.apply },
        },
        {
          resultHandler: (data) => renderCodeEditApply(data as any),
        }
      );
    }
    return runCommandStream(
      commandClient,
      {
        command: 'codeEditList',
        payload: { status: options.status, agent: options.agent },
      },
      {
        resultHandler: (data) => renderCodeEditList(data as any, options),
      }
    );
  },
  'db:status': createServiceCommandAction({
    command: 'dbStatus',
    payload: () => ({}),
    resultHandler: (data) => renderDbStatus(data as any),
  }),
  'db:migrate': createServiceCommandAction({
    command: 'dbMigrate',
    payload: () => ({}),
    resultHandler: (data) => renderDbMigrate(data as any),
  }),
  patch: (file: string, line: string, content: string, rest: string[]) => {
    const changes: Array<{ line: number; content: string }> = [];
    const allPairs: Array<[string, string]> = [[line, content]];
    for (let i = 0; i + 1 < rest.length; i += 2) {
      allPairs.push([rest[i], rest[i + 1]]);
    }
    for (const [ls, c] of allPairs) {
      const n = parseInt(ls, 10);
      if (isNaN(n) || n < 1) {
        throw new Error(`Line must be a positive integer, got: ${ls}`);
      }
      changes.push({ line: n, content: c });
    }
    return runCommandStream(
      commandClient,
      {
        command: 'patchApply',
        payload: { file, changes },
      },
      {
        resultHandler: (data) => renderPatchApply(data as any),
      }
    );
  },
  files: createServiceCommandAction({
    command: 'filesTree',
    payload: (options) => {
      const typed = (options ?? {}) as {
        depth?: string;
        all?: boolean;
        noGitignore?: boolean;
        agent?: string;
        writeable?: boolean;
      };
      return {
        agent: typed.agent,
        depth: typed.depth ? Number.parseInt(typed.depth, 10) : undefined,
        all: typed.all,
        noGitignore: typed.noGitignore,
        writeable: typed.writeable,
      };
    },
    resultHandler: (data, args) =>
      renderFilesTree(
        data as any,
        (args[0] ?? {}) as {
          depth?: string;
          all?: boolean;
          noGitignore?: boolean;
          json?: boolean;
          agent?: string;
          writeable?: boolean;
        }
      ),
  }),
  'files.allow': (
    p: string,
    options: {
      agent?: string;
      requestedBy?: string;
      approvedByUser?: boolean;
      write?: boolean;
      mode?: string;
    }
  ) => renderFilesAllow(commandClient, p, options),
  'files.disallow': (
    p: string,
    options: {
      agent?: string;
      requestedBy?: string;
      approvedByUser?: boolean;
      write?: boolean;
      mode?: string;
    }
  ) => renderFilesDeny(commandClient, p, options),
  'files.patterns': createServiceCommandAction({
    command: 'filesPatterns',
    payload: (options) => ({ agent: (options as { agent?: string } | undefined)?.agent }),
    resultHandler: (data, args) =>
      renderFilesPatterns(data as any, (args[0] ?? {}) as { agent?: string; json?: boolean }),
  }),
  tools: createServiceCommandAction({
    command: 'toolsList',
    payload: (options) => ({ agent: (options as { agent?: string } | undefined)?.agent }),
    resultHandler: (data, args) =>
      renderToolsList(data as any, (args[0] ?? {}) as { agent?: string; json?: boolean }),
  }),
  access: () => undefined,
  'access.who': createServiceCommandAction({
    command: 'accessWho',
    payload: (options) => ({
      path: (options as { path?: string } | undefined)?.path ?? '',
      right: (options as { right?: 'read' | 'write' | 'list' } | undefined)?.right,
    }),
    useResultRegistry: true,
  }),
  'access.can': createServiceCommandAction({
    command: 'accessCan',
    payload: (options) => ({
      path: (options as { path?: string } | undefined)?.path ?? '',
      right: (options as { right?: 'read' | 'write' | 'list' } | undefined)?.right,
      agent: (options as { agent?: string } | undefined)?.agent,
    }),
    useResultRegistry: true,
  }),
  'access.overlap': createServiceCommandAction({
    command: 'accessOverlap',
    payload: (options) => ({
      mode: (options as { mode?: 'files' | 'patterns' } | undefined)?.mode,
      right: (options as { right?: 'read' | 'write' | 'list' } | undefined)?.right,
      agent: (options as { agent?: string } | undefined)?.agent,
    }),
    useResultRegistry: true,
  }),
  'tools.allow': (options: {
    agent?: string;
    tool?: string;
    requestedBy?: string;
    approvedByUser?: boolean;
    json?: boolean;
  }) => renderToolsAllow(commandClient, options),
  'tools.disallow': (options: {
    agent?: string;
    tool?: string;
    requestedBy?: string;
    approvedByUser?: boolean;
    json?: boolean;
  }) => renderToolsDeny(commandClient, options),
  workflow: () => undefined,
  'workflow.list': () =>
    renderChat(
      commandClient,
      undefined,
      {
        message: '/workflow list',
        oneShot: true,
      },
      false
    ),
  'workflow.show': (workflowId: string) =>
    renderChat(
      commandClient,
      undefined,
      {
        message: `/workflow ${workflowId}`,
        oneShot: true,
      },
      false
    ),
  skills: (options: { query?: string; agent?: string; json?: boolean }) =>
    runCommandStream(
      commandClient,
      {
        command: 'skillsList',
        payload: { query: options.query, agent: options.agent },
      },
      {
        resultHandler: (data) => renderSkillsList(data as any, options),
      }
    ),
  search: (
    query: string | undefined,
    options: {
      role?: string;
      type?: string;
      status?: string;
      feature?: string;
      specialization?: string;
      tool?: string;
      reportsTo?: string;
      contextLevel?: string;
      json?: boolean;
    }
  ) =>
    runCommandStream(
      commandClient,
      {
        command: 'searchAgents',
        payload: {
          query,
          role: options.role,
          type: options.type,
          status: options.status,
          feature: options.feature,
          specialization: options.specialization,
          tool: options.tool,
          reportsTo: options.reportsTo,
          contextLevel: options.contextLevel,
        },
      },
      {
        resultHandler: (data) =>
          renderSearchResults(data as any, {
            query,
            json: options.json,
            hasFilters: Boolean(
              options.role ||
              options.type ||
              options.status ||
              options.feature ||
              options.specialization ||
              options.tool ||
              options.reportsTo ||
              options.contextLevel
            ),
          }),
      }
    ),
  'skills.add': (options: { agent?: string; skill?: string; json?: boolean }) => {
    if (!options.agent?.trim()) throw new Error('Missing required option --agent');
    if (!options.skill?.trim()) throw new Error('Missing required option --skill');
    return runCommandStream(
      commandClient,
      {
        command: 'skillsAdd',
        payload: { agent: options.agent, skill: options.skill },
      },
      {
        resultHandler: (data) => renderSkillsAdd(data as any, options),
      }
    );
  },
  'skills.remove': (options: { agent?: string; skill?: string; json?: boolean }) => {
    if (!options.agent?.trim()) throw new Error('Missing required option --agent');
    if (!options.skill?.trim()) throw new Error('Missing required option --skill');
    return runCommandStream(
      commandClient,
      {
        command: 'skillsRemove',
        payload: { agent: options.agent, skill: options.skill },
      },
      {
        resultHandler: (data) => renderSkillsRemove(data as any, options),
      }
    );
  },
  hh: () => undefined,
  'hh.refresh': () =>
    runCommandStream(commandClient, {
      command: 'hhRefresh',
      payload: {},
    }),
  'test-connection': (options) =>
    runCommandStream(commandClient, {
      command: 'testConnection',
      payload: { options },
    }),
  serve: (options) => launchServer(options, workspaceRoot),
  'serve.ui': (options) => launchServerWithUi(options, workspaceRoot),
  ui: (options) => launchUi(options, workspaceRoot),
  provider: () => undefined,
  'provider.configure': (options) => renderProviderConfigure(commandClient, options),
  'provider.add': () => renderProviderAdd(commandClient),
  'provider.set': (options) => renderProviderSet(commandClient, options),
  'provider.list': (options) =>
    runCommandStream(commandClient, {
      command: 'providerList',
      payload: { options },
    }),
  'provider.models': (options) =>
    runCommandStream(commandClient, {
      command: 'providerModels',
      payload: { options },
    }),
  'provider.models.refresh': (options) =>
    runCommandStream(commandClient, {
      command: 'providerModelsRefresh',
      payload: { options },
    }),
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
      (entry.llmCallable ? createDefaultRegistryAction(entry) : undefined);
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

program.parse();
