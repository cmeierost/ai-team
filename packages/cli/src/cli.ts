#!/usr/bin/env node
/**
 * AI Team CLI
 * Command-line interface for managing virtual AI development teams
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { registerCliCommandCatalog, type CliCommandMetadata } from '@ai-team/core';
import {
  createLocalAiTeamClient,
  ServiceDomainError,
  type ServiceErrorInputRequest,
} from '@ai-team/api-client';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { createCommand } from './commands/create.js';
import { chatCommand } from './commands/chat.js';
import { graphCommand } from './commands/graph.js';
import { hireCommand } from './commands/hire.js';
import { infoCommand } from './commands/info.js';
import { fireCommand } from './commands/fire.js';
import { hhRefreshCommand } from './commands/hh.js';

import { testConnectionCommand } from './commands/test-connection.js';
import { providerAddCommand, providerConfigureCommand, providerSetCommand } from './commands/provider.js';
import { providerListCommand, providerModelsCommand, providerModelsRefreshCommand } from './commands/models.js';
import { orgCommand } from './commands/org.js';
import { CLI_COMMAND_REGISTRY, getCliCommandMetadata } from './commands/registry.js';

registerCliCommandCatalog(CLI_COMMAND_REGISTRY);

const program = new Command();
const client = createLocalAiTeamClient(process.cwd());

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
  action: (...args: TArgs) => Promise<unknown> | unknown,
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

program
  .name('ai-team')
  .description('Manage virtual AI development teams')
  .version('0.1.0');

const initMeta = getCliCommandMetadata('init');
applyCommandMetadata(program.command(initMeta.command), initMeta).action(withCliErrorHandling((options) => initCommand(client, options)));

const listMeta = getCliCommandMetadata('list');
applyCommandMetadata(program.command(listMeta.command), listMeta).action(withCliErrorHandling((options) => listCommand(client, options)));

const createMeta = getCliCommandMetadata('create');
applyCommandMetadata(program.command(createMeta.command), createMeta).action(withCliErrorHandling((type, options) => createCommand(client, type, options)));

const chatMeta = getCliCommandMetadata('chat');
applyCommandMetadata(program.command(chatMeta.command), chatMeta)
  .action(withCliErrorHandling((agentId: string | undefined, messageParts: string[] | undefined, options: { message?: string; context?: string[]; mediatorLog?: boolean }) => {
    const { mediatorLog, ...chatOptions } = options;
    const inlineMessage = messageParts && messageParts.length > 0
      ? messageParts.join(' ')
      : undefined;
    const hasOptionMessage = Boolean(chatOptions.message || inlineMessage);
    const message = chatOptions.message || inlineMessage;
    return chatCommand(client, agentId, { ...chatOptions, message, oneShot: hasOptionMessage }, Boolean(mediatorLog));
  }));

const graphMeta = getCliCommandMetadata('graph');
applyCommandMetadata(program.command(graphMeta.command), graphMeta).action(withCliErrorHandling((options) => graphCommand(client, options)));

const orgMeta = getCliCommandMetadata('org');
applyCommandMetadata(program.command(orgMeta.command), orgMeta).action(withCliErrorHandling((options) => orgCommand(client, options)));

const hireMeta = getCliCommandMetadata('hire');
applyCommandMetadata(program.command(hireMeta.command), hireMeta).action(withCliErrorHandling((options) => hireCommand(client, options)));

const infoMeta = getCliCommandMetadata('info');
applyCommandMetadata(program.command(infoMeta.command), infoMeta).action(withCliErrorHandling((agentId, options) => infoCommand(client, agentId, options)));

const fireMeta = getCliCommandMetadata('fire');
applyCommandMetadata(program.command(fireMeta.command), fireMeta).action(withCliErrorHandling((agentQuery, options) => fireCommand(client, agentQuery, options)));

const hhMeta = getCliCommandMetadata('hh');
const hh = applyCommandMetadata(program.command(hhMeta.command), hhMeta);

const hhRefreshMeta = getCliCommandMetadata('hh.refresh');
applyCommandMetadata(hh.command(hhRefreshMeta.command), hhRefreshMeta).action(withCliErrorHandling(() => hhRefreshCommand(client)));

const testConnectionMeta = getCliCommandMetadata('test-connection');
applyCommandMetadata(program.command(testConnectionMeta.command), testConnectionMeta).action(withCliErrorHandling((options) => testConnectionCommand(client, options)));

const providerMeta = getCliCommandMetadata('provider');
const provider = applyCommandMetadata(program.command(providerMeta.command), providerMeta);

const providerConfigureMeta = getCliCommandMetadata('provider.configure');
applyCommandMetadata(provider.command(providerConfigureMeta.command), providerConfigureMeta).action(withCliErrorHandling((options) => providerConfigureCommand(client, options)));

const providerAddMeta = getCliCommandMetadata('provider.add');
applyCommandMetadata(provider.command(providerAddMeta.command), providerAddMeta).action(withCliErrorHandling(() => providerAddCommand(client)));

const providerSetMeta = getCliCommandMetadata('provider.set');
applyCommandMetadata(provider.command(providerSetMeta.command), providerSetMeta).action(withCliErrorHandling((options) => providerSetCommand(client, options)));

const providerListMeta = getCliCommandMetadata('provider.list');
applyCommandMetadata(provider.command(providerListMeta.command), providerListMeta).action(withCliErrorHandling((options) => providerListCommand(client, options)));

const providerModelsMeta = getCliCommandMetadata('provider.models');
const providerModels = applyCommandMetadata(provider.command(providerModelsMeta.command), providerModelsMeta)
  .action(withCliErrorHandling((options) => providerModelsCommand(client, options)));

const providerModelsRefreshMeta = getCliCommandMetadata('provider.models.refresh');
applyCommandMetadata(providerModels.command(providerModelsRefreshMeta.command), providerModelsRefreshMeta)
  .action(withCliErrorHandling((options) => providerModelsRefreshCommand(client, options)));

program.parse();
