import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const searchCliMetadata: CliCommandMetadata = {
  key: 'search',
  command: 'search [query]',
  description: 'Search for team members by name, role, skills, or expertise',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '-r, --role <role>', description: 'Filter by role' },
    {
      flags: '-t, --type <type>',
      description: 'Filter by type (executive, team-lead, individual-contributor)',
    },
    { flags: '-s, --status <status>', description: 'Filter by status (active, busy, offline)' },
    { flags: '-f, --feature <feature>', description: 'Filter by feature' },
    { flags: '--specialization <spec>', description: 'Filter by specialization' },
    { flags: '--tool <tool>', description: 'Filter by tool' },
    { flags: '--reports-to <agent>', description: 'Filter by reports-to relationship' },
    { flags: '--context-level <level>', description: 'Filter by context level' },
    { flags: '--json', description: 'Output as JSON' },
  ],
};

export const searchCommandDefinition = createFactoryCommandDefinition(
  'searchAgents',
  searchCliMetadata,
  async (container, payload) => {
    const { SearchAgentsCommand } = await import('@ai-team/service/src/commands/search.js');
    const { COMMAND_FACTORY_TOKENS } = await import('@ai-team/service/src/commands/definitions/types.js');
    return new SearchAgentsCommand(container.resolve(COMMAND_FACTORY_TOKENS.AgentManager)).execute({
      query: payload.query,
      role: payload.role as any,
      type: payload.type as any,
      status: payload.status as any,
      feature: payload.feature,
      specialization: payload.specialization,
      tool: payload.tool,
      reportsTo: payload.reportsTo,
      contextLevel: payload.contextLevel as any,
    });
  }
);
