#!/usr/bin/env node
/**
 * AI Team CLI
 * Command-line interface for managing virtual AI development teams
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { createContainerWithBootstrap } from '@ai-team/container';
import type { IServiceContainer } from '@ai-team/core';
import { registerCliCommandCatalog, type CliCommandMetadata } from '@ai-team/infrastructure';
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
import { renderAccessCan, renderAccessOverlap, renderAccessWho } from './handlers/access.js';
import { runCommandStream } from './handlers/stream-runner.js';
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
import { CLI_COMMAND_REGISTRY } from './handlers/registry.js';
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

  if (metadata.aliases) {
    for (const alias of metadata.aliases) {
      command.alias(alias);
    }
  }

  if (metadata.arguments) {
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

  return command;
}

const workspaceRoot = findWorkspaceRoot();

const commandContainer = createContainerWithBootstrap({ workspaceRoot }, () => {});
const commandClient = new CliCommandClient(
  workspaceRoot,
  commandContainer.child() as unknown as IServiceContainer
);

type CliActionHandler = (...args: any[]) => Promise<unknown> | unknown;

const directCliActionHandlers: Record<string, CliActionHandler> = {
  init: (options) => renderInit(commandClient, options),
  list: (options: { role?: string; feature?: string; json?: boolean }) =>
    runCommandStream(
      commandClient,
      {
        command: 'listEmployees',
        payload: { role: options.role, feature: options.feature },
      },
      {
        resultHandler: (data) => renderAgentList(data, options),
      }
    ),
  create: (type: string, options) =>
    runCommandStream(commandClient, {
      command: 'create',
      payload: { type: type.toLowerCase(), options },
    }),
  chat: (
    agentId: string | undefined,
    messageParts: string[] | undefined,
    options: {
      message?: string;
      context?: string[];
      mediatorLog?: boolean;
      new?: boolean;
      session?: string;
    }
  ) => {
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
  org: (options: { mermaid?: boolean; output?: string }) =>
    runCommandStream(
      commandClient,
      {
        command: 'getOrganizationGraph',
        payload: {},
      },
      {
        resultHandler: (data) => renderOrgGraph(data, options),
      }
    ),
  hire: (options) =>
    runCommandStream(commandClient, {
      command: 'hire',
      payload: { options },
    }),
  info: (agentId: string, options: { json?: boolean }) =>
    runCommandStream(
      commandClient,
      {
        command: 'resolveEmployees',
        payload: { query: agentId },
      },
      {
        resultHandler: (data) => renderAgentInfo(data, agentId, options),
      }
    ),
  fire: (agentQuery: string, options: { force?: boolean }) =>
    runCommandStream(commandClient, {
      command: 'fire',
      payload: { employeeQuery: agentQuery, options },
    }),
  show: (agentId: string) =>
    runCommandStream(
      commandClient,
      {
        command: 'resolveEmployees',
        payload: { query: agentId },
      },
      {
        resultHandler: (data) =>
          renderAgentInfo(data, agentId, { openAvatar: true, workspaceRoot }),
      }
    ),
  avatar: (agentQuery: string) =>
    runCommandStream(commandClient, {
      command: 'avatar',
      payload: { options: { agentQuery } },
    }),
  sysinfo: (options: { json?: boolean }) =>
    runCommandStream(
      commandClient,
      {
        command: 'systemInfo',
        payload: {},
      },
      {
        resultHandler: (data) => renderSysinfo(data, options),
      }
    ),
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
          resultHandler: (data) => renderCodeEditApprove(data),
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
          resultHandler: (data) => renderCodeEditReject(data),
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
          resultHandler: (data) => renderCodeEditApply(data),
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
        resultHandler: (data) => renderCodeEditList(data, options),
      }
    );
  },
  'db:status': () =>
    runCommandStream(
      commandClient,
      {
        command: 'dbStatus',
        payload: {},
      },
      {
        resultHandler: (data) => renderDbStatus(data),
      }
    ),
  'db:migrate': () =>
    runCommandStream(
      commandClient,
      {
        command: 'dbMigrate',
        payload: {},
      },
      {
        resultHandler: (data) => renderDbMigrate(data),
      }
    ),
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
        resultHandler: (data) => renderPatchApply(data),
      }
    );
  },
  files: (options: {
    depth?: string;
    all?: boolean;
    noGitignore?: boolean;
    json?: boolean;
    agent?: string;
    writeable?: boolean;
  }) =>
    runCommandStream(
      commandClient,
      {
        command: 'filesTree',
        payload: {
          agent: options.agent,
          depth: options.depth ? Number.parseInt(options.depth, 10) : undefined,
          all: options.all,
          noGitignore: options.noGitignore,
          writeable: options.writeable,
        },
      },
      {
        resultHandler: (data) => renderFilesTree(data, options),
      }
    ),
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
  'files.patterns': (options: { agent?: string; json?: boolean }) =>
    runCommandStream(
      commandClient,
      {
        command: 'filesPatterns',
        payload: { agent: options.agent },
      },
      {
        resultHandler: (data) => renderFilesPatterns(data, options),
      }
    ),
  tools: (options: { agent?: string; json?: boolean }) =>
    runCommandStream(
      commandClient,
      {
        command: 'toolsList',
        payload: { agent: options.agent },
      },
      {
        resultHandler: (data) => renderToolsList(data, options),
      }
    ),
  access: () => undefined,
  'access.who': (options: { path?: string; right?: 'read' | 'write' | 'list'; json?: boolean }) =>
    runCommandStream(
      commandClient,
      {
        command: 'accessWho',
        payload: { path: options.path ?? '', right: options.right },
      },
      {
        resultHandler: (data) => renderAccessWho(data, options),
      }
    ),
  'access.can': (options: {
    path?: string;
    right?: 'read' | 'write' | 'list';
    agent?: string;
    json?: boolean;
  }) =>
    runCommandStream(
      commandClient,
      {
        command: 'accessCan',
        payload: { path: options.path ?? '', right: options.right, agent: options.agent },
      },
      {
        resultHandler: (data) => renderAccessCan(data, options),
      }
    ),
  'access.overlap': (options: {
    mode?: 'files' | 'patterns';
    right?: 'read' | 'write' | 'list';
    agent?: string;
    json?: boolean;
  }) =>
    runCommandStream(
      commandClient,
      {
        command: 'accessOverlap',
        payload: { mode: options.mode, right: options.right, agent: options.agent },
      },
      {
        resultHandler: (data) => renderAccessOverlap(data, options),
      }
    ),
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
  skills: (options: { query?: string; agent?: string; json?: boolean }) =>
    runCommandStream(
      commandClient,
      {
        command: 'skillsList',
        payload: { query: options.query, agent: options.agent },
      },
      {
        resultHandler: (data) => renderSkillsList(data, options),
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
          renderSearchResults(data, {
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
        resultHandler: (data) => renderSkillsAdd(data, options),
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
        resultHandler: (data) => renderSkillsRemove(data, options),
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
    const actionHandler = actionHandlers[entry.key];
    if (!actionHandler) {
      throw new Error(`Direct CLI action handler missing for '${entry.key}'.`);
    }

    command.action(withCliErrorHandling(actionHandler));
    registeredCommands.set(entry.key, command);
    return command;
  };

  for (const entry of directEntries) {
    registerEntry(entry);
  }
}

program.name('ai-team').description('Manage virtual AI development teams').version('0.1.0');
registerDirectCliCommands(program, CLI_COMMAND_REGISTRY, directCliActionHandlers);

program.parse();
