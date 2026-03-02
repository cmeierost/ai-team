import type { CliCommandMetadata } from '@ai-team/core';

export const CLI_COMMAND_REGISTRY: CliCommandMetadata[] = [
  {
    key: 'init',
    command: 'init',
    description: 'Initialize AI Team in current workspace',
    llmCallable: false,
    options: [
      { flags: '-t, --template <type>', description: 'Use a starter template', defaultValue: 'basic' },
      { flags: '-f, --force', description: 'Force reinitialize even if already initialized' },
    ],
  },
  {
    key: 'list',
    command: 'list',
    description: 'List all team members',
    llmCallable: true,
    options: [
      { flags: '-r, --role <role>', description: 'Filter by role' },
      { flags: '-f, --feature <feature>', description: 'Filter by feature' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'search',
    command: 'search [query]',
    description: 'Search for team members by name, role, skills, or expertise',
    llmCallable: true,
    options: [
      { flags: '-r, --role <role>', description: 'Filter by role' },
      { flags: '-t, --type <type>', description: 'Filter by type (executive, team-lead, individual-contributor)' },
      { flags: '-s, --status <status>', description: 'Filter by status (active, busy, offline)' },
      { flags: '-f, --feature <feature>', description: 'Filter by feature' },
      { flags: '--specialization <spec>', description: 'Filter by specialization' },
      { flags: '--tool <tool>', description: 'Filter by tool' },
      { flags: '--reports-to <agent>', description: 'Filter by reports-to relationship' },
      { flags: '--context-level <level>', description: 'Filter by context level' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'create',
    command: 'create <type>',
    description: 'Create a new entity (agent or skill)',
    llmCallable: true,
    options: [
      { flags: '-n, --name <name>', description: 'Employee name' },
      { flags: '-r, --role <role>', description: 'Employee role' },
      { flags: '--interactive', description: 'Interactive mode' },
    ],
  },
  {
    key: 'chat',
    command: 'chat [agent-id]',
    description: 'Start a chat session with an employee',
    llmCallable: false,
    arguments: [
      { syntax: '[message...]', description: 'Optional inline message to send immediately' },
    ],
    options: [
      { flags: '-m, --message <message>', description: 'Send a single message' },
      { flags: '-c, --context <files...>', description: 'Include files in context' },
      { flags: '--mediator-log', description: 'Print raw mediator runtime/stream event logs' },
    ],
  },
  {
    key: 'graph',
    command: 'graph',
    description: 'Generate team graph',
    llmCallable: true,
    options: [
      { flags: '-m, --mode <mode>', description: 'View mode: hierarchy, features, expertise, matrix', defaultValue: 'hierarchy' },
      { flags: '-o, --output <file>', description: 'Export to file (SVG, PNG, or JSON)' },
    ],
  },
  {
    key: 'org',
    command: 'org',
    description: 'Show organization hierarchy',
    llmCallable: true,
    options: [
      { flags: '-o, --output <file>', description: 'Export to JSON or Mermaid (with --mermaid)' },
      { flags: '--mermaid', description: 'Output Mermaid diagram text instead of ASCII tree' },
    ],
  },
  {
    key: 'hire',
    command: 'hire',
    description: 'Hire a new team member',
    llmCallable: true,
    options: [
      { flags: '-n, --name <name>', description: 'Employee name' },
      { flags: '-r, --role <role>', description: 'Unique role name' },
      { flags: '-s, --skill <skill>', description: 'Skill from catalog' },
      { flags: '-t, --type <type>', description: 'Role type (executive, team-lead, individual-contributor, etc.)' },
      { flags: '--reports-to <agent>', description: 'Manager employee ID' },
      { flags: '--no-chat', description: 'Skip the onboarding chat phase' },
    ],
  },
  {
    key: 'info',
    command: 'info <agent>',
    description: 'Show detailed information about an employee',
    llmCallable: true,
    options: [{ flags: '--json', description: 'Output as JSON' }],
  },
  {
    key: 'fire',
    command: 'fire <agent>',
    description: 'Fire (delete) an employee and remove their data',
    llmCallable: true,
    options: [{ flags: '-f, --force', description: 'Do not prompt for confirmation' }],
  },
  {
    key: 'hh',
    command: 'hh',
    description: 'Headhunter — scout skills and manage the talent catalog',
    llmCallable: false,
  },
  {
    key: 'hh.refresh',
    command: 'refresh',
    parentKey: 'hh',
    description: 'Pull and refresh the skill catalog from GitHub',
    llmCallable: true,
  },
  {
    key: 'test-connection',
    command: 'test-connection',
    description: 'Test LLM provider/model connectivity',
    llmCallable: true,
    options: [
      { flags: '-e, --employee <employee>', description: 'Resolve employee by fuzzy search and test their effective model/provider' },
      { flags: '-p, --provider <providerRef>', description: 'Provider reference key in config.providers' },
      { flags: '--model-key <modelKey>', description: 'Model key from provider models dictionary' },
      { flags: '--model <modelId>', description: 'Direct model ID override (bypasses model key)' },
      { flags: '--all', description: 'Test all configured model keys (optionally scoped by --provider)' },
    ],
  },
  {
    key: 'provider',
    command: 'provider',
    description: 'Manage LLM providers',
    llmCallable: false,
  },
  {
    key: 'provider.configure',
    command: 'configure',
    parentKey: 'provider',
    description: 'Configure default LLM provider',
    llmCallable: true,
  },
  {
    key: 'provider.add',
    command: 'add',
    parentKey: 'provider',
    description: 'Add a provider profile',
    llmCallable: true,
  },
  {
    key: 'provider.set',
    command: 'set',
    parentKey: 'provider',
    description: 'Configure default LLM provider',
    llmCallable: true,
  },
  {
    key: 'provider.list',
    command: 'list',
    parentKey: 'provider',
    description: 'List configured provider profiles',
    llmCallable: true,
    options: [{ flags: '--json', description: 'Output as JSON' }],
  },
  {
    key: 'provider.models',
    command: 'models',
    parentKey: 'provider',
    description: 'List model key dictionaries for all providers (or a single one with --provider)',
    llmCallable: true,
    options: [
      { flags: '-p, --provider <providerRef>', description: 'Provider reference key in config.providers' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'provider.models.refresh',
    command: 'refresh',
    parentKey: 'provider.models',
    description: 'Refresh model dictionary from provider endpoint',
    llmCallable: true,
    options: [{ flags: '-p, --provider <providerRef>', description: 'Provider reference key in config.providers' }],
  },
];

export const IN_CHAT_COMMAND_REGISTRY = [
  { key: 'chat', usage: '/chat <name|role>', description: 'Switch to another employee', llmCallable: false },
  { key: 'list', usage: '/list', description: 'List all team members', llmCallable: true },
  { key: 'who', usage: '/who', description: 'Show who you are currently talking to', llmCallable: false },
  { key: 'hire', usage: '/hire', description: 'Hire a new team member', llmCallable: true },
  { key: 'overview', usage: '/overview', description: 'Show workspace file overview', llmCallable: false },
  { key: 'run', usage: '/run <command>', description: 'Run a shell command and share its output', llmCallable: false },
  { key: 'info', usage: '/info <employee>', description: 'Show detailed information about an employee', llmCallable: true },
  { key: 'fire', usage: '/fire <employee>', description: 'Fire (delete) an employee and remove their data', llmCallable: true },
  { key: 'create', usage: '/create [employee|skill]', description: 'Create a new team member or role', llmCallable: true },
  { key: 'hh', usage: '/hh refresh', description: 'Pull and refresh the skill catalog from GitHub', llmCallable: true },
  {
    key: 'test-connection',
    usage: '/test-connection',
    description: 'Test LLM provider/model connectivity',
    llmCallable: true,
  },
  { key: 'init', usage: '/init', description: 'Initialize AI Team in current workspace', llmCallable: false },
  { key: 'history', usage: '/history', description: 'Show recent messages (history 20 for more)', llmCallable: false },
  { key: 'portfolio', usage: '/portfolio', description: "Show the employee's portfolio / bio", llmCallable: false },
  { key: 'graph', usage: '/graph', description: 'Generate team graph', llmCallable: true },
  { key: 'help', usage: '/help', description: 'Show this help', llmCallable: false },
  { key: 'tool', usage: '#<tool> <json>', description: 'Run a direct tool call', llmCallable: false },
] as const;

export const IN_CHAT_COMMAND_ALIASES: Record<string, string> = {
  shell: 'run',
  bio: 'portfolio',
};

export function getLlmCallableCliCommands(): CliCommandMetadata[] {
  return CLI_COMMAND_REGISTRY.filter(entry => entry.llmCallable);
}

export function getCliCommandMetadata(key: string): CliCommandMetadata {
  const match = CLI_COMMAND_REGISTRY.find(entry => entry.key === key);
  if (!match) {
    throw new Error(`Command metadata not found for key '${key}'.`);
  }
  return match;
}
