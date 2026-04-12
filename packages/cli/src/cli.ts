#!/usr/bin/env node
/**
 * AI Team CLI
 * Command-line interface for managing virtual AI development teams
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { registerCliCommandCatalog, type CliCommandMetadata } from '@ai-team/infrastructure';
import { createContainer, TOKENS, type TransportAdapterFactory } from '@ai-team/container';
import { CliMediator } from './cli-mediator.js';
import {
  findWorkspaceRoot,
  ServiceDomainError,
  type ServiceErrorInputRequest,
} from '@ai-team/service';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { createCommand } from './commands/create.js';
import { chatCommand } from './commands/chat.js';
import { graphCommand } from './commands/graph.js';
import { hireCommand } from './commands/hire.js';
import { infoCommand } from './commands/info.js';
import { fireCommand } from './commands/fire.js';
import { sysinfoCommand } from './commands/sysinfo.js';
import { hhRefreshCommand } from './commands/hh.js';
import { codeEditCommand } from './commands/code-edit.js';
import { avatarCommand } from './commands/avatar.js';
import { patchCommand } from './commands/patch.js';
import {
  filesCommand,
  filesAllowCommand,
  filesDisallowCommand,
  filesPatternsCommand,
} from './commands/files.js';
import { accessCanCommand, accessOverlapCommand, accessWhoCommand } from './commands/access.js';
import { toolsAllowCommand, toolsCommand, toolsDisallowCommand } from './commands/tools.js';
import { skillsAddCommand, skillsCommand, skillsRemoveCommand } from './commands/skills.js';

import { testConnectionCommand } from './commands/test-connection.js';
import {
  providerAddCommand,
  providerConfigureCommand,
  providerSetCommand,
} from './commands/provider.js';
import {
  providerListCommand,
  providerModelsCommand,
  providerModelsRefreshCommand,
} from './commands/models.js';
import { orgCommand } from './commands/org.js';
import { serveCommand } from './commands/serve.js';
import { uiCommand } from './commands/ui.js';
import { CLI_COMMAND_REGISTRY, getCliCommandMetadata } from './commands/registry.js';
import { dbStatusCommand, dbMigrateCommand } from './commands/db.js';

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
const createCliMediator: TransportAdapterFactory = (c) =>
  new CliMediator(c.resolve(TOKENS.WorkspaceRoot));

const container = createContainer({
  workspaceRoot,
  transportAdapterFactory: createCliMediator,
});

const commandClient = container.resolve(TOKENS.AiTeamMediator);
const agentsClient = container.resolve(TOKENS.AgentsService);
const skillsClient = container.resolve(TOKENS.SkillsService);
const toolsClient = container.resolve(TOKENS.ToolsService);
const accessClient = container.resolve(TOKENS.AccessService);
const orgClient = container.resolve(TOKENS.TeamService);
const configClient = container.resolve(TOKENS.ConfigService);

program.name('ai-team').description('Manage virtual AI development teams').version('0.1.0');

const initMeta = getCliCommandMetadata('init');
applyCommandMetadata(program.command(initMeta.command), initMeta).action(
  withCliErrorHandling((options) => initCommand(commandClient, options))
);

const listMeta = getCliCommandMetadata('list');
applyCommandMetadata(program.command(listMeta.command), listMeta).action(
  withCliErrorHandling((options) => listCommand(agentsClient, options))
);

const createMeta = getCliCommandMetadata('create');
applyCommandMetadata(program.command(createMeta.command), createMeta).action(
  withCliErrorHandling((type, options) => createCommand(commandClient, type, options))
);

const chatMeta = getCliCommandMetadata('chat');
applyCommandMetadata(program.command(chatMeta.command), chatMeta).action(
  withCliErrorHandling(
    (
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
      return chatCommand(
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
    }
  )
);

const graphMeta = getCliCommandMetadata('graph');
applyCommandMetadata(program.command(graphMeta.command), graphMeta).action(
  withCliErrorHandling((options) => graphCommand(orgClient, options))
);

const orgMeta = getCliCommandMetadata('org');
applyCommandMetadata(program.command(orgMeta.command), orgMeta).action(
  withCliErrorHandling((options) => orgCommand(orgClient, options))
);

const hireMeta = getCliCommandMetadata('hire');
applyCommandMetadata(program.command(hireMeta.command), hireMeta).action(
  withCliErrorHandling((options) => hireCommand(commandClient, options))
);

const infoMeta = getCliCommandMetadata('info');
applyCommandMetadata(program.command(infoMeta.command), infoMeta).action(
  withCliErrorHandling((agentId, options) => infoCommand(agentsClient, agentId, options))
);

// Show command - open avatar only
program
  .command('show <agent>')
  .description('Open the avatar image for an employee')
  .action(
    withCliErrorHandling((agentId) => infoCommand(agentsClient, agentId, { openAvatar: true }))
  );

const fireMeta = getCliCommandMetadata('fire');
applyCommandMetadata(program.command(fireMeta.command), fireMeta).action(
  withCliErrorHandling((agentQuery, options) => fireCommand(commandClient, agentQuery, options))
);

// Avatar command
program
  .command('avatar <agent>')
  .description('Download and set an avatar picture for an agent')
  .action(
    withCliErrorHandling((agentQuery) =>
      avatarCommand(agentQuery, { workspaceRoot: process.cwd() })
    )
  );

// System info command
program
  .command('sysinfo')
  .alias('sys')
  .description('Display system information about the workspace')
  .option('--json', 'Output as JSON')
  .action(withCliErrorHandling((options) => sysinfoCommand(options)));

// Files / file tree command
const files = program
  .command('files')
  .description(
    'Preview the workspace file tree with gitignore awareness and optional agent-scoped filtering'
  )
  .option('-d, --depth <number>', 'Max recursion depth (default: 4)')
  .option('-a, --all', 'Include hidden files and directories')
  .option('--no-gitignore', 'Ignore .gitignore rules and show all files')
  .option('--json', 'Output as JSON')
  .option('--agent <id>', 'Show files accessible to a specific agent')
  .option('--writeable', 'Show writeable files instead of readable (requires --agent)')
  .action(withCliErrorHandling((options) => filesCommand(options)));

files
  .command('allow <path>')
  .description(
    'Allow a path in file visibility (global config) or agent access rules (governed when --agent is used)'
  )
  .option('--agent <id>', 'Scope to a specific agent (updates their .md permissions)')
  .option(
    '--requested-by <agent>',
    'Governance actor requesting the change (default policy typically allows CEO or HR Director)'
  )
  .option(
    '--approved-by-user',
    'Mark user approval as granted and skip interactive confirmation prompt'
  )
  .option('--write', 'Affect write permissions instead of read (default: read)')
  .option('--mode <mode>', 'Permission mode: read | write | create | delete')
  .action(
    withCliErrorHandling(
      (
        p: string,
        options: {
          agent?: string;
          requestedBy?: string;
          approvedByUser?: boolean;
          write?: boolean;
          mode?: string;
        }
      ) => filesAllowCommand(p, options)
    )
  );

files
  .command('disallow <path>')
  .description(
    'Disallow a path from file visibility (global config) or agent access rules (governed when --agent is used)'
  )
  .option('--agent <id>', 'Scope to a specific agent (updates their .md permissions)')
  .option(
    '--requested-by <agent>',
    'Governance actor requesting the change (default policy typically allows CEO or HR Director)'
  )
  .option(
    '--approved-by-user',
    'Mark user approval as granted and skip interactive confirmation prompt'
  )
  .option('--write', 'Affect write permissions instead of read (default: read)')
  .option('--mode <mode>', 'Permission mode: read | write | create | delete')
  .action(
    withCliErrorHandling(
      (
        p: string,
        options: {
          agent?: string;
          requestedBy?: string;
          approvedByUser?: boolean;
          write?: boolean;
          mode?: string;
        }
      ) => filesDisallowCommand(p, options)
    )
  );

files
  .command('patterns')
  .description('List configured file permission patterns (global or per-agent)')
  .option('--agent <id>', 'Show patterns for a specific agent')
  .option('--json', 'Output as JSON')
  .action(
    withCliErrorHandling((options: { agent?: string; json?: boolean }) =>
      filesPatternsCommand(options)
    )
  );

const toolsMeta = getCliCommandMetadata('tools');
const tools = applyCommandMetadata(program.command(toolsMeta.command), toolsMeta).action(
  withCliErrorHandling((options: { agent?: string; json?: boolean }) =>
    toolsCommand(toolsClient, options)
  )
);

const accessMeta = getCliCommandMetadata('access');
const access = applyCommandMetadata(program.command(accessMeta.command), accessMeta);

const accessWhoMeta = getCliCommandMetadata('access.who');
applyCommandMetadata(access.command(accessWhoMeta.command), accessWhoMeta).action(
  withCliErrorHandling(
    (options: { path?: string; right?: 'read' | 'write' | 'list'; json?: boolean }) =>
      accessWhoCommand(accessClient, options)
  )
);

const accessCanMeta = getCliCommandMetadata('access.can');
applyCommandMetadata(access.command(accessCanMeta.command), accessCanMeta).action(
  withCliErrorHandling(
    (options: {
      path?: string;
      right?: 'read' | 'write' | 'list';
      agent?: string;
      json?: boolean;
    }) => accessCanCommand(accessClient, options)
  )
);

const accessOverlapMeta = getCliCommandMetadata('access.overlap');
applyCommandMetadata(access.command(accessOverlapMeta.command), accessOverlapMeta).action(
  withCliErrorHandling(
    (options: {
      mode?: 'files' | 'patterns';
      right?: 'read' | 'write' | 'list';
      agent?: string;
      json?: boolean;
    }) => accessOverlapCommand(accessClient, options)
  )
);

const toolsAllowMeta = getCliCommandMetadata('tools.allow');
applyCommandMetadata(tools.command(toolsAllowMeta.command).alias('add'), toolsAllowMeta).action(
  withCliErrorHandling(
    (options: {
      agent?: string;
      tool?: string;
      requestedBy?: string;
      approvedByUser?: boolean;
      json?: boolean;
    }) => toolsAllowCommand(toolsClient, options)
  )
);

const toolsDisallowMeta = getCliCommandMetadata('tools.disallow');
applyCommandMetadata(
  tools.command(toolsDisallowMeta.command).alias('remove'),
  toolsDisallowMeta
).action(
  withCliErrorHandling(
    (options: {
      agent?: string;
      tool?: string;
      requestedBy?: string;
      approvedByUser?: boolean;
      json?: boolean;
    }) => toolsDisallowCommand(toolsClient, options)
  )
);

const skillsMeta = getCliCommandMetadata('skills');
const skills = applyCommandMetadata(program.command(skillsMeta.command), skillsMeta).action(
  withCliErrorHandling((options: { query?: string; agent?: string; json?: boolean }) =>
    skillsCommand(skillsClient, options)
  )
);

const skillsAddMeta = getCliCommandMetadata('skills.add');
applyCommandMetadata(skills.command(skillsAddMeta.command), skillsAddMeta).action(
  withCliErrorHandling((options: { agent?: string; skill?: string; json?: boolean }) =>
    skillsAddCommand(skillsClient, options)
  )
);

const skillsRemoveMeta = getCliCommandMetadata('skills.remove');
applyCommandMetadata(skills.command(skillsRemoveMeta.command), skillsRemoveMeta).action(
  withCliErrorHandling((options: { agent?: string; skill?: string; json?: boolean }) =>
    skillsRemoveCommand(skillsClient, options)
  )
);

const hhMeta = getCliCommandMetadata('hh');
const hh = applyCommandMetadata(program.command(hhMeta.command), hhMeta);

const hhRefreshMeta = getCliCommandMetadata('hh.refresh');
applyCommandMetadata(hh.command(hhRefreshMeta.command), hhRefreshMeta).action(
  withCliErrorHandling(() => hhRefreshCommand(commandClient))
);

const testConnectionMeta = getCliCommandMetadata('test-connection');
applyCommandMetadata(program.command(testConnectionMeta.command), testConnectionMeta).action(
  withCliErrorHandling((options) => testConnectionCommand(commandClient, options))
);

const serveMeta = getCliCommandMetadata('serve');
applyCommandMetadata(program.command(serveMeta.command), serveMeta).action(
  withCliErrorHandling((options) => serveCommand(options))
);

const uiMeta = getCliCommandMetadata('ui');
applyCommandMetadata(program.command(uiMeta.command), uiMeta).action(
  withCliErrorHandling((options) => uiCommand(options))
);

const providerMeta = getCliCommandMetadata('provider');
const provider = applyCommandMetadata(program.command(providerMeta.command), providerMeta);

const providerConfigureMeta = getCliCommandMetadata('provider.configure');
applyCommandMetadata(provider.command(providerConfigureMeta.command), providerConfigureMeta).action(
  withCliErrorHandling((options) => providerConfigureCommand(commandClient, options))
);

const providerAddMeta = getCliCommandMetadata('provider.add');
applyCommandMetadata(provider.command(providerAddMeta.command), providerAddMeta).action(
  withCliErrorHandling(() => providerAddCommand(commandClient))
);

const providerSetMeta = getCliCommandMetadata('provider.set');
applyCommandMetadata(provider.command(providerSetMeta.command), providerSetMeta).action(
  withCliErrorHandling((options) => providerSetCommand(commandClient, options))
);

const providerListMeta = getCliCommandMetadata('provider.list');
applyCommandMetadata(provider.command(providerListMeta.command), providerListMeta).action(
  withCliErrorHandling((options) => providerListCommand(commandClient, options))
);

const providerModelsMeta = getCliCommandMetadata('provider.models');
const providerModels = applyCommandMetadata(
  provider.command(providerModelsMeta.command),
  providerModelsMeta
).action(withCliErrorHandling((options) => providerModelsCommand(commandClient, options)));

const providerModelsRefreshMeta = getCliCommandMetadata('provider.models.refresh');
applyCommandMetadata(
  providerModels.command(providerModelsRefreshMeta.command),
  providerModelsRefreshMeta
).action(withCliErrorHandling((options) => providerModelsRefreshCommand(commandClient, options)));

// Code edit proposals command
program
  .command('code-edit')
  .description('Manage code edit proposals')
  .option('--status <status>', 'Filter by status (PENDING, APPROVED, APPLIED, REJECTED, FAILED)')
  .option('--agent <agent>', 'Filter by agent name')
  .option('--approve <id>', 'Approve a proposal')
  .option('--reject <id>', 'Reject a proposal')
  .option('--apply <id>', 'Apply an approved proposal')
  .action(withCliErrorHandling((options) => codeEditCommand(process.cwd(), options)));

// Database commands
program.addCommand(dbStatusCommand(process.cwd()));
program.addCommand(dbMigrateCommand(process.cwd()));

// Patch: replace one or more lines in a file and push through the proposal pipeline
// Usage: ait patch <file> <line> <content> [<line2> <content2> ...]
program
  .command('patch <file> <line> <content> [rest...]')
  .description('Replace one or more lines in a file and send a code-edit proposal to VS Code')
  .action(
    withCliErrorHandling((file: string, line: string, content: string, rest: string[]) =>
      patchCommand(file, line, content, rest)
    )
  );

program.parse();
