import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createContainerWithBootstrap } from '@ai-team/container';
import type { IServiceContainer } from '@ai-team/core';
import {
  createCommandDispatcher,
  findWorkspaceRoot,
  IN_CHAT_COMMAND_ALIASES,
  IN_CHAT_COMMAND_REGISTRY,
} from '@ai-team/service';
export { IN_CHAT_COMMAND_ALIASES, IN_CHAT_COMMAND_REGISTRY };

interface CliCommandMetadataOverride extends CliCommandMetadata {
  /** Optional service command key to hydrate base metadata from before applying override fields. */
  serviceKey?: string;
}

const CLI_COMMAND_METADATA_OVERRIDES: CliCommandMetadataOverride[] = [
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
    serviceKey: 'listEmployees',
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
  {
    key: 'files',
    serviceKey: 'filesTree',
    command: 'files',
    description: 'Preview the workspace file tree with gitignore awareness and optional agent-scoped filtering',
    llmCallable: true,
    directCli: true,
    options: [
      { flags: '-d, --depth <number>', description: 'Max recursion depth (default: 4)' },
      { flags: '-a, --all', description: 'Include hidden files and directories' },
      { flags: '--no-gitignore', description: 'Ignore .gitignore rules' },
      { flags: '--json', description: 'Output as JSON' },
      { flags: '--agent <agent>', description: 'Show files accessible to a specific agent' },
      { flags: '--writeable', description: 'Show writeable files instead of readable' },
    ],
  },
  {
    key: 'files.allow',
    serviceKey: 'filesAllow',
    command: 'allow <path>',
    parentKey: 'files',
    description: 'Allow a path in file visibility (global config) or agent access rules',
    llmCallable: true,
    directCli: true,
    options: [
      { flags: '--agent <agent>', description: 'Scope to a specific agent' },
      { flags: '--mode <mode>', description: 'Permission mode: read | write' },
    ],
  },
  {
    key: 'files.disallow',
    serviceKey: 'filesDeny',
    command: 'disallow <path>',
    parentKey: 'files',
    description: 'Disallow a path in file visibility (global config) or agent access rules',
    llmCallable: true,
    directCli: true,
    options: [
      { flags: '--agent <agent>', description: 'Scope to a specific agent' },
      { flags: '--mode <mode>', description: 'Permission mode: read | write' },
    ],
  },
  {
    key: 'files.patterns',
    serviceKey: 'filesPatterns',
    command: 'patterns',
    parentKey: 'files',
    description: 'List configured file permission patterns (global or per-agent)',
    llmCallable: true,
    directCli: true,
    options: [
      { flags: '--agent <agent>', description: 'Show patterns for a specific agent' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'tools',
    serviceKey: 'toolsList',
    command: 'tools',
    description: 'List available tools and optionally annotate permissions for an agent',
    llmCallable: true,
    directCli: true,
    options: [
      { flags: '--agent <agent>', description: 'Show tool allow/deny state for a specific agent' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'access',
    command: 'access',
    description: 'Access introspection commands',
    llmCallable: false,
    directCli: true,
  },
  {
    key: 'access.who',
    serviceKey: 'accessWho',
    command: 'who',
    parentKey: 'access',
    description: 'Show which contexts/agents can access a path for a right',
    llmCallable: true,
    directCli: true,
    arguments: [{ syntax: '<path>', description: 'Path to evaluate' }],
    options: [
      { flags: '--right <right>', description: 'Right to evaluate: read | write | list' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'access.can',
    serviceKey: 'accessCan',
    command: 'can',
    parentKey: 'access',
    description: 'Check whether a context/agent can access a path for a right',
    llmCallable: true,
    directCli: true,
    arguments: [{ syntax: '<path>', description: 'Path to evaluate' }],
    options: [
      { flags: '--right <right>', description: 'Right to evaluate: read | write | list' },
      { flags: '--agent <agent>', description: 'Optional agent query override' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'access.overlap',
    serviceKey: 'accessOverlap',
    command: 'overlap',
    parentKey: 'access',
    description: 'Analyze overlap between agent .perm file responsibilities by right',
    llmCallable: true,
    directCli: true,
    options: [
      { flags: '--mode <mode>', description: 'Analysis mode: files | patterns' },
      { flags: '--right <right>', description: 'Optional right filter' },
      { flags: '--agent <agent>', description: 'Optional exact agent id filter' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'tools.allow',
    serviceKey: 'toolsAllow',
    command: 'allow',
    parentKey: 'tools',
    description: 'Allow a tool for an agent (governed)',
    llmCallable: true,
    directCli: true,
    aliases: ['add'],
    arguments: [
      { syntax: '<agent>', description: 'Agent id, name, or role query' },
      { syntax: '<tool>', description: 'Tool name to allow' },
    ],
    options: [
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'tools.disallow',
    serviceKey: 'toolsDeny',
    command: 'disallow',
    parentKey: 'tools',
    description: 'Disallow a tool for an agent (governed)',
    llmCallable: true,
    directCli: true,
    aliases: ['remove'],
    arguments: [
      { syntax: '<agent>', description: 'Agent id, name, or role query' },
      { syntax: '<tool>', description: 'Tool name to disallow' },
    ],
    options: [
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'workflow',
    command: 'workflow',
    description: 'Workflow tools (list and inspect registered workflow definitions)',
    llmCallable: false,
    directCli: true,
  },
  {
    key: 'workflow.list',
    command: 'list',
    parentKey: 'workflow',
    description: 'List registered workflows',
    llmCallable: true,
    directCli: true,
  },
  {
    key: 'workflow.show',
    command: 'show <workflowId>',
    parentKey: 'workflow',
    description: 'Show a specific workflow definition',
    llmCallable: true,
    directCli: true,
    arguments: [{ syntax: '<workflowId>', description: 'Workflow id (e.g. chat-full-loop)' }],
  },
  {
    key: 'skills',
    serviceKey: 'skillsList',
    command: 'skills',
    description: 'List skills in the catalog or assigned to an agent',
    llmCallable: true,
    directCli: true,
    options: [
      { flags: '--query <query>', description: 'Filter by name, description, responsibility, or tool' },
      { flags: '--agent <agent>', description: 'Annotate assignment state for a specific agent' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'skills.add',
    serviceKey: 'skillsAdd',
    command: 'add',
    parentKey: 'skills',
    description: 'Add a skill to an agent',
    llmCallable: true,
    directCli: true,
    arguments: [
      { syntax: '<agent>', description: 'Agent id, name, or role query' },
      { syntax: '<skill>', description: 'Skill name to add' },
    ],
    options: [
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'skills.remove',
    serviceKey: 'skillsRemove',
    command: 'remove',
    parentKey: 'skills',
    description: 'Remove a skill from an agent',
    llmCallable: true,
    directCli: true,
    arguments: [
      { syntax: '<agent>', description: 'Agent id, name, or role query' },
      { syntax: '<skill>', description: 'Skill name to remove' },
    ],
    options: [
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'search',
    serviceKey: 'searchAgents',
    command: 'search [query]',
    description: 'Search for team members by name, role, skills, or expertise',
    llmCallable: true,
    directCli: true,
    options: [
      { flags: '-r, --role <role>', description: 'Filter by role' },
      { flags: '--type <type>', description: 'Filter by type' },
      { flags: '--status <status>', description: 'Filter by status' },
      { flags: '--feature <feature>', description: 'Filter by feature' },
      { flags: '--tool <tool>', description: 'Filter by tool' },
      { flags: '--reports-to <agent>', description: 'Filter by reports-to relationship' },
      { flags: '--json', description: 'Output as JSON' },
    ],
  },
  {
    key: 'create',
    command: 'create <type>',
    description: 'Create a new entity (agent or skill)',
    llmCallable: true,
    directCli: true,
    arguments: [{ syntax: '<type>', description: 'Entity type: agent | skill' }],
    options: [
      { flags: '--name <name>', description: 'Name' },
      { flags: '--role <role>', description: 'Role name' },
      { flags: '-i, --interactive', description: 'Interactive mode' },
    ],
  },
  {
    key: 'chat',
    serviceKey: 'chat',
    command: 'chat [agent-id]',
    description: 'Start a chat session with an agent',
    llmCallable: false,
    directCli: true,
    options: [
      { flags: '-m, --message <message>', description: 'Send a single message' },
      { flags: '-c, --context <files...>', description: 'Include files in context' },
      { flags: '--mediator-log', description: 'Print raw mediator runtime/stream event logs' },
      { flags: '--new', description: 'Start a new session instead of resuming the latest' },
      { flags: '-s, --session <id>', description: 'Resume a specific session by ID' },
    ],
  },
  {
    key: 'graph',
    serviceKey: 'getTeamGraph',
    command: 'graph',
    description: 'Generate team graph',
    llmCallable: true,
    directCli: true,
    options: [
      { flags: '--mode <mode>', description: 'View mode: hierarchy | features | expertise | matrix' },
    ],
  },
  {
    key: 'org',
    serviceKey: 'getOrganizationGraph',
    command: 'org',
    description: 'Show organization hierarchy',
    llmCallable: true,
    directCli: true,
  },
  {
    key: 'hire',
    command: 'hire',
    description: 'Hire a new team member',
    llmCallable: true,
    directCli: true,
    options: [
      { flags: '--name <name>', description: 'Employee name' },
      { flags: '--role <role>', description: 'Unique role name' },
      { flags: '--skill <skill>', description: 'Skill from catalog' },
      { flags: '--type <type>', description: 'Role type' },
      { flags: '--reports-to <agent>', description: 'Manager employee ID' },
      { flags: '--chat', description: 'Run onboarding chat phase' },
    ],
  },
  {
    key: 'info',
    serviceKey: 'resolveEmployees',
    command: 'info <agent>',
    description: 'Show detailed information about an employee',
    llmCallable: true,
    directCli: true,
    arguments: [{ syntax: '<agent>', description: 'Agent id, name, or role query' }],
  },
  {
    key: 'fire',
    serviceKey: 'fire',
    command: 'fire <agent>',
    description: 'Fire (delete) an employee and remove their data',
    llmCallable: true,
    directCli: true,
    arguments: [{ syntax: '<agent>', description: 'Agent id, name, or role query' }],
    options: [
      { flags: '-f, --force', description: 'Do not prompt for confirmation' },
    ],
  },
  {
    key: 'show',
    command: 'show <agent>',
    description: 'Open the avatar image for an employee',
    llmCallable: false,
    directCli: true,
  },
  {
    key: 'avatar',
    serviceKey: 'avatar',
    command: 'avatar <agent>',
    description: 'Download and set an avatar picture for an agent',
    llmCallable: true,
    directCli: true,
    arguments: [{ syntax: '<agent>', description: 'Agent id, name, or role query' }],
  },
  {
    key: 'sysinfo',
    serviceKey: 'systemInfo',
    command: 'sysinfo',
    description: 'Display system information about the workspace',
    llmCallable: false,
    directCli: true,
  },
  {
    key: 'code-edit',
    serviceKey: 'codeEditList',
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
  {
    key: 'db:status',
    serviceKey: 'dbStatus',
    command: 'db:status',
    description: 'Show database status and statistics',
    llmCallable: false,
    directCli: true,
  },
  {
    key: 'db:migrate',
    serviceKey: 'dbMigrate',
    command: 'db:migrate',
    description: 'Reset and initialize database schema (alpha)',
    llmCallable: false,
    directCli: true,
  },
  {
    key: 'patch',
    serviceKey: 'patchApply',
    command: 'patch <file> <line> <content>',
    description: 'Apply line-level patch changes to a file',
    llmCallable: false,
    directCli: true,
    arguments: [
      { syntax: '<file>', description: 'File path to patch' },
      { syntax: '<line>', description: 'Line number (1-based)' },
      { syntax: '<content>', description: 'New content for the line' },
    ],
  },
  {
    key: 'hh',
    command: 'hh',
    description: 'Headhunter — scout skills and manage the talent catalog',
    llmCallable: false,
    directCli: true,
  },
  {
    key: 'hh.refresh',
    serviceKey: 'hhRefresh',
    command: 'refresh',
    parentKey: 'hh',
    description: 'Pull and refresh the skill catalog from GitHub',
    llmCallable: true,
    directCli: true,
  },
  {
    key: 'test-connection',
    serviceKey: 'testConnection',
    command: 'test-connection',
    description: 'Test LLM provider/model connectivity',
    llmCallable: false,
    directCli: true,
    options: [
      { flags: '--employee <agent>', description: 'Resolve employee and test their effective model' },
      { flags: '--provider <provider>', description: 'Provider reference key in config.providers' },
      { flags: '--model-key <key>', description: 'Model key from provider models dictionary' },
      { flags: '--model <model>', description: 'Direct model ID override' },
      { flags: '--all', description: 'Test all configured model keys' },
      { flags: '--tool-call', description: 'Verify a simple tool-call roundtrip' },
    ],
  },
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
    serviceKey: 'providerConfigure',
    command: 'configure',
    parentKey: 'provider',
    description: 'Configure default LLM provider',
    llmCallable: true,
    directCli: true,
  },
  {
    key: 'provider.add',
    serviceKey: 'providerAdd',
    command: 'add',
    parentKey: 'provider',
    description: 'Add a provider profile',
    llmCallable: true,
    directCli: true,
  },
  {
    key: 'provider.set',
    serviceKey: 'providerSet',
    command: 'set',
    parentKey: 'provider',
    description: 'Configure default LLM provider',
    llmCallable: true,
    directCli: true,
  },
  {
    key: 'provider.list',
    serviceKey: 'providerList',
    command: 'list',
    parentKey: 'provider',
    description: 'List configured provider profiles',
    llmCallable: true,
    directCli: true,
    options: [{ flags: '--json', description: 'Output as JSON' }],
  },
  {
    key: 'provider.models',
    serviceKey: 'providerModels',
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
    serviceKey: 'providerModelsRefresh',
    command: 'refresh',
    parentKey: 'provider.models',
    description: 'Refresh model dictionary from provider endpoint',
    llmCallable: true,
    directCli: true,
    options: [{ flags: '-p, --provider <providerRef>', description: 'Provider reference key in config.providers' }],
  },
];

function loadServiceCliCommandRegistry(): CliCommandMetadata[] {
  const workspaceRoot = findWorkspaceRoot();
  const container = createContainerWithBootstrap({ workspaceRoot }, () => {});
  const dispatcher = createCommandDispatcher(
    workspaceRoot,
    container.child() as unknown as IServiceContainer
  );

  return dispatcher.getCommands({ cli: true }).map((command) => ({
    key: command.key,
    command: command.usage ?? command.key,
    description: command.description,
    llmCallable: Boolean(command.availableIn.tool),
    directCli: true,
    aliases: command.aliases,
    options: undefined,
    hints: command.help?.hints,
    examples: command.help?.examples?.map((example) => example.value),
    jsonSignature: command.input?.jsonSignature,
  }));
}

function buildCliCommandRegistry(): CliCommandMetadata[] {
  const serviceEntries = loadServiceCliCommandRegistry();
  const serviceByKey = new Map(serviceEntries.map((entry) => [entry.key, entry]));
  const suppressedServiceKeys = new Set(['codeEditApprove', 'codeEditReject', 'codeEditApply']);

  const merged = new Map<string, CliCommandMetadata>();
  const orderedKeys: string[] = [];
  const usedServiceKeys = new Set<string>();

  for (const override of CLI_COMMAND_METADATA_OVERRIDES) {
    const serviceKey = override.serviceKey ?? override.key;
    const serviceEntry = serviceByKey.get(serviceKey);
    if (serviceEntry) {
      usedServiceKeys.add(serviceKey);
    }

    const mergedEntry: CliCommandMetadata = {
      ...(serviceEntry ?? {
        key: override.key,
        command: override.command ?? override.key,
        description: override.description,
        llmCallable: override.llmCallable,
        directCli: override.directCli,
      }),
      ...override,
      key: override.key,
      aliases: override.aliases ?? serviceEntry?.aliases,
      options: override.options ?? serviceEntry?.options,
      arguments: override.arguments ?? serviceEntry?.arguments,
      hints: override.hints ?? serviceEntry?.hints,
      examples: override.examples ?? serviceEntry?.examples,
      jsonSignature: override.jsonSignature ?? serviceEntry?.jsonSignature,
    };

    if (!merged.has(mergedEntry.key)) {
      orderedKeys.push(mergedEntry.key);
    }
    merged.set(mergedEntry.key, mergedEntry);
  }

  for (const serviceEntry of serviceEntries) {
    if (
      usedServiceKeys.has(serviceEntry.key) ||
      merged.has(serviceEntry.key) ||
      suppressedServiceKeys.has(serviceEntry.key)
    ) {
      continue;
    }
    orderedKeys.push(serviceEntry.key);
    merged.set(serviceEntry.key, serviceEntry);
  }

  return orderedKeys
    .map((key) => merged.get(key))
    .filter((entry): entry is CliCommandMetadata => Boolean(entry));
}

export const CLI_COMMAND_REGISTRY: CliCommandMetadata[] = buildCliCommandRegistry();

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
