import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { CLI_COMMAND_METADATA_BY_KEY } from '@ai-team/container';
export { IN_CHAT_COMMAND_ALIASES, IN_CHAT_COMMAND_REGISTRY } from '@ai-team/service';

function getRequiredDefinitionMetadata(key: string): CliCommandMetadata {
  const metadata = CLI_COMMAND_METADATA_BY_KEY.get(key);
  if (!metadata) {
    throw new Error(`Command definition metadata not found for key '${key}'.`);
  }
  return metadata;
}

export const CLI_COMMAND_REGISTRY: CliCommandMetadata[] = [
  {
    key: 'init',
    command: 'init',
    description: 'Initialize AI Team in current workspace',
    llmCallable: false,
    directCli: true,
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
    directCli: true,
    options: [
      { flags: '-r, --role <role>', description: 'Filter by role' },
      { flags: '-f, --feature <feature>', description: 'Filter by feature' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  getRequiredDefinitionMetadata('files'),
  getRequiredDefinitionMetadata('files.allow'),
  getRequiredDefinitionMetadata('files.disallow'),
  getRequiredDefinitionMetadata('files.patterns'),
  getRequiredDefinitionMetadata('tools'),
  {
    key: 'access',
    command: 'access',
    description: 'Access introspection commands',
    llmCallable: false,
    directCli: true,
  },
  getRequiredDefinitionMetadata('access.who'),
  getRequiredDefinitionMetadata('access.can'),
  getRequiredDefinitionMetadata('access.overlap'),
  getRequiredDefinitionMetadata('tools.allow'),
  getRequiredDefinitionMetadata('tools.disallow'),
  getRequiredDefinitionMetadata('skills'),
  getRequiredDefinitionMetadata('skills.add'),
  getRequiredDefinitionMetadata('skills.remove'),
  getRequiredDefinitionMetadata('search'),
  getRequiredDefinitionMetadata('create'),
  getRequiredDefinitionMetadata('chat'),
  getRequiredDefinitionMetadata('graph'),
  getRequiredDefinitionMetadata('org'),
  getRequiredDefinitionMetadata('hire'),
  getRequiredDefinitionMetadata('info'),
  getRequiredDefinitionMetadata('fire'),
  {
    key: 'show',
    command: 'show <agent>',
    description: 'Open the avatar image for an employee',
    llmCallable: false,
    directCli: true,
  },
  getRequiredDefinitionMetadata('avatar'),
  getRequiredDefinitionMetadata('sysinfo'),
  {
    key: 'code-edit',
    command: 'code-edit',
    description: 'Manage code edit proposals',
    llmCallable: false,
    directCli: true,
    options: [
      { flags: '--status <status>', description: 'Filter by status (PENDING, APPROVED, APPLIED, REJECTED, FAILED)' },
      { flags: '--agent <agent>', description: 'Filter by agent name' },
      { flags: '--json', description: 'Output as JSON' },
      { flags: '--approve <id>', description: 'Approve a proposal' },
      { flags: '--reject <id>', description: 'Reject a proposal' },
      { flags: '--apply <id>', description: 'Apply an approved proposal' },
    ],
  },
  getRequiredDefinitionMetadata('db:status'),
  getRequiredDefinitionMetadata('db:migrate'),
  getRequiredDefinitionMetadata('patch'),
  {
    key: 'hh',
    command: 'hh',
    description: 'Headhunter — scout skills and manage the talent catalog',
    llmCallable: false,
    directCli: true,
  },
  getRequiredDefinitionMetadata('hh.refresh'),
  getRequiredDefinitionMetadata('test-connection'),
  {
    key: 'serve',
    command: 'serve',
    description: 'Start the AI Team API server',
    llmCallable: false,
    directCli: true,
    options: [
      { flags: '-p, --port <number>', description: 'Port for the API server (defaults to 3002)', defaultValue: '3002' },
      { flags: '-w, --workspace <path>', description: 'Workspace root for the API server' },
      { flags: '--ui', description: 'Also launch the web UI in a separate process' },
      { flags: '--ui-server-url <url>', description: 'Server URL to pass to `ait ui` (default: http://127.0.0.1:<port>)' },
    ],
  },
  {
    key: 'serve.ui',
    command: 'ui',
    parentKey: 'serve',
    description: 'Start both API server and web UI together',
    llmCallable: false,
    directCli: true,
    options: [
      { flags: '-w, --workspace <path>', description: 'Workspace root for starting UI and API dev servers' },
    ],
  },
  {
    key: 'ui',
    command: 'ui',
    description: 'Start the web UI and also start the API when it is not already running',
    llmCallable: false,
    directCli: true,
    options: [
      { flags: '-w, --workspace <path>', description: 'Workspace root for starting UI and API dev servers' },
      { flags: '--server-url <url>', description: 'Backend server URL for the web UI (default: http://localhost:3002 in local dev)' },
    ],
  },
  {
    key: 'provider',
    command: 'provider',
    description: 'Manage LLM providers',
    llmCallable: false,
    directCli: true,
  },
  {
    key: 'provider.configure',
    command: 'configure',
    parentKey: 'provider',
    description: 'Configure default LLM provider',
    llmCallable: true,
    directCli: true,
  },
  {
    key: 'provider.add',
    command: 'add',
    parentKey: 'provider',
    description: 'Add a provider profile',
    llmCallable: true,
    directCli: true,
  },
  {
    key: 'provider.set',
    command: 'set',
    parentKey: 'provider',
    description: 'Configure default LLM provider',
    llmCallable: true,
    directCli: true,
  },
  {
    key: 'provider.list',
    command: 'list',
    parentKey: 'provider',
    description: 'List configured provider profiles',
    llmCallable: true,
    directCli: true,
    options: [{ flags: '--json', description: 'Output as JSON' }],
  },
  {
    key: 'provider.models',
    command: 'models',
    parentKey: 'provider',
    description: 'List model key dictionaries for all providers (or a single one with --provider)',
    llmCallable: true,
    directCli: true,
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
    directCli: true,
    options: [{ flags: '-p, --provider <providerRef>', description: 'Provider reference key in config.providers' }],
  },
];

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
