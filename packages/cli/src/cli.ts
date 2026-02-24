#!/usr/bin/env node
/**
 * AI Team CLI
 * Command-line interface for managing virtual AI development teams
 */

import { Command } from 'commander';
import chalk from 'chalk';
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
import { providerSetCommand } from './commands/provider.js';
import { providerModelsCommand, providerModelsRefreshCommand } from './commands/models.js';
import { orgCommand } from './commands/org.js';

const program = new Command();

program
  .name('ai-team')
  .description('Manage virtual AI development teams')
  .version('0.1.0');

// Initialize workspace
program
  .command('init')
  .description('Initialize AI Team in current workspace')
  .option('-t, --template <type>', 'Use a starter template', 'basic')
  .option('-f, --force', 'Force reinitialize even if already initialized')
  .action(initCommand);

// List agents
program
  .command('list')
  .description('List all team members')
  .option('-r, --role <role>', 'Filter by role')
  .option('-f, --feature <feature>', 'Filter by feature')
  .option('--json', 'Output as JSON')
  .action(listCommand);

// Create agent
program
  .command('create <type>')
  .description('Create a new team member or role')
  .argument('<type>', 'What to create: agent, skill')
  .option('-n, --name <name>', 'Agent name')
  .option('-r, --role <role>', 'Agent role')
  .option('--interactive', 'Interactive mode')
  .action(createCommand);

// Chat with agent
program
  .command('chat <agent-id>')
  .argument('[message...]', 'Optional inline message to send immediately')
  .description('Start a chat session with an agent')
  .option('-m, --message <message>', 'Send a single message')
  .option('-c, --context <files...>', 'Include files in context')
  .action((agentId: string, messageParts: string[] | undefined, options: { message?: string; context?: string[] }) => {
    const inlineMessage = messageParts && messageParts.length > 0
      ? messageParts.join(' ')
      : undefined;
    const hasOptionMessage = Boolean(options.message);
    const message = options.message || inlineMessage;
    return chatCommand(agentId, { ...options, message, oneShot: hasOptionMessage });
  });

// View team graph
program
  .command('graph')
  .description('View team organization graph')
  .option('-m, --mode <mode>', 'View mode: hierarchy, features, expertise, matrix', 'hierarchy')
  .option('-o, --output <file>', 'Export to file (SVG, PNG, or JSON)')
  .action(graphCommand);

// Quick org overview
program
  .command('org')
  .description('Show organization hierarchy (fast CLI view)')
  .option('-o, --output <file>', 'Export to JSON or Mermaid (with --mermaid)')
  .option('--mermaid', 'Output Mermaid diagram text instead of ASCII tree')
  .action(orgCommand);

// Hire a new team member
program
  .command('hire')
  .description('Hire a new team member (interactive workflow)')
  .option('-n, --name <name>', 'Employee name')
  .option('-r, --role <role>', 'Unique role name')
  .option('-s, --skill <skill>', 'Skill from catalog')
  .option('-t, --type <type>', 'Role type (executive, team-lead, individual-contributor, etc.)')
  .option('--reports-to <agent>', 'Manager agent ID')
  .option('--no-chat', 'Skip the onboarding chat phase')
  .action(hireCommand);

// Agent info / portfolio
program
  .command('info <agent>')
  .description('Show detailed profile for an agent')
  .option('--json', 'Output as JSON')
  .action(infoCommand);

// Fire (delete) an agent
program
  .command('fire <agent>')
  .description('Fire (delete) an agent and remove their data')
  .option('-f, --force', 'Do not prompt for confirmation')
  .action(fireCommand);

// Headhunter commands
const hh = program
  .command('hh')
  .description('Headhunter — scout skills and manage the talent catalog');

hh
  .command('refresh')
  .description('Scout and refresh skill catalog from GitHub')
  .action(hhRefreshCommand);

// Test LLM connection
program
  .command('test-connection')
  .description('Test the configured LLM connection')
  .option('-e, --employee <employee>', 'Resolve employee by fuzzy search and test their effective model/provider')
  .option('-p, --provider <providerRef>', 'Provider reference key in config.providers')
  .option('--model-key <modelKey>', 'Model key from provider models dictionary')
  .option('--model <modelId>', 'Direct model ID override (bypasses model key)')
  .option('--all', 'Test all configured model keys (optionally scoped by --provider)')
  .action(testConnectionCommand);

// Provider commands
const provider = program
  .command('provider')
  .description('Manage LLM providers and models');

provider
  .command('set')
  .description('Interactively change LLM provider and update configuration')
  .action(providerSetCommand);

const providerModels = provider
  .command('models')
  .description('List available models from the configured LLM provider')
  .option('-p, --provider <providerRef>', 'Provider reference key in config.providers')
  .option('--json', 'Output as JSON')
  .action(providerModelsCommand);

providerModels
  .command('refresh')
  .description('Refresh provider model dictionary from provider /models endpoint')
  .option('-p, --provider <providerRef>', 'Provider reference key in config.providers')
  .action(providerModelsRefreshCommand);

program.parse();
