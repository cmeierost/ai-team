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
  .description('Start a chat session with an agent')
  .option('-m, --message <message>', 'Send a single message')
  .option('-c, --context <files...>', 'Include files in context')
  .action(chatCommand);

// View team graph
program
  .command('graph')
  .description('View team organization graph')
  .option('-m, --mode <mode>', 'View mode: hierarchy, features, expertise, matrix', 'hierarchy')
  .option('-o, --output <file>', 'Export to file (SVG, PNG, or JSON)')
  .action(graphCommand);

program.parse();
