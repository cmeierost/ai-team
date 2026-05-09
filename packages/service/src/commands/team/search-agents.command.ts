import { z } from 'zod';
import type { ICommand, CommandRuntime, IAgentManager } from '@ai-team/core';
import type { SearchAgentsResponse } from '@ai-team/api-contracts';

type Params = z.infer<typeof SearchAgentsICommand.schema>;

export class SearchAgentsICommand implements ICommand<Params, void, SearchAgentsResponse> {
  static readonly schema = z.object({
    query: z.string().optional().describe('Search by name, role, skills, or expertise'),
    role: z.string().optional().describe('Filter by role'),
    type: z.string().optional().describe('Filter by type'),
    status: z.string().optional().describe('Filter by status'),
    feature: z.string().optional().describe('Filter by feature'),
    specialization: z.string().optional().describe('Filter by specialization'),
    tool: z.string().optional().describe('Filter by tool'),
    reportsTo: z.string().optional().describe('Filter by reports-to relationship'),
    contextLevel: z.string().optional().describe('Filter by context level'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'searchAgents';
  readonly cli = { command: 'search [query]' };
  readonly description = 'Search for team members by name, role, skills, or expertise';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'team';
  readonly parameters = SearchAgentsICommand.schema;

  constructor(private readonly agents: IAgentManager) {}

  async execute(
    payload: Params,
    _ctx: void,
    _runtime: CommandRuntime
  ): Promise<SearchAgentsResponse> {
    const results = await this.agents.searchAgentsAsync(payload as any);
    return { results, totalCount: results.length };
  }
}
