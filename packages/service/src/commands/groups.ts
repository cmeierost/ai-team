export interface GroupInfo {
  displayName: string;
  description: string;
}

/**
 * Registry of all known command groups with display names and descriptions.
 * Used by help formatting and CLI parent command scaffolding.
 */
export const GROUP_REGISTRY: Record<string, GroupInfo> = {
  chat: {
    displayName: 'Chat',
    description: 'General chat session commands',
  },
  cli: {
    displayName: 'CLI',
    description: 'Run approved local command-line tools',
  },
  com: {
    displayName: 'Communication',
    description: 'Coordinate work between team members',
  },
  access: {
    displayName: 'Access',
    description: 'Inspect and analyze agent path permissions',
  },
  code: {
    displayName: 'Code',
    description: 'Code intelligence — symbol lookup, references, diagnostics',
  },
  context: {
    displayName: 'Context',
    description: 'Manage LLM context window — add, remove, list, summarize messages',
  },
  db: {
    displayName: 'Database',
    description: 'Database migrations and status',
  },
  edit: {
    displayName: 'Edit',
    description: 'Code edit proposals — create, apply, approve, reject',
  },
  fs: {
    displayName: 'Filesystem',
    description: 'Read, write, and search workspace files',
  },
  hr: {
    displayName: 'HR',
    description: 'Human resources — skill catalog refresh',
  },
  http: {
    displayName: 'HTTP',
    description: 'Fetch and crawl web pages',
  },
  search: {
    displayName: 'Search',
    description: 'Semantic and grep-based code search',
  },
  session: {
    displayName: 'Session',
    description: 'Manage chat sessions — switch, history, inspect',
  },
  setup: {
    displayName: 'Setup',
    description: 'Configure LLM providers, models, and connectivity',
  },
  skills: {
    displayName: 'Skills',
    description: 'Manage agent skill assignments',
  },
  system: {
    displayName: 'System',
    description: 'System and workspace diagnostics',
  },
  team: {
    displayName: 'Team',
    description: 'Search, resolve, and visualize team members',
  },
  tool: {
    displayName: 'Tools',
    description: 'Inspect and govern agent tool permissions',
  },
  workflow: {
    displayName: 'Workflow',
    description: 'List and invoke orchestration workflows',
  },
};
