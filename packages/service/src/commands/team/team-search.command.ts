import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SearchAgentsResponse } from '@ai-team/api-contracts';

type Params = z.infer<typeof SearchAgentsICommand.schema>;
const _searchAgentsICommandSchema = z.object({
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

export const SearchAgentsICommandMetadata = {
  key: 'search',
  description: 'Search for team members by name, role, skills, or expertise',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'team',
  parameters: _searchAgentsICommandSchema,
} satisfies ICommandDescriptor;

export class SearchAgentsICommand implements ICommand<Params, SearchAgentsResponse> {
  static readonly schema = _searchAgentsICommandSchema;
  readonly metadata = SearchAgentsICommandMetadata;

  constructor(private readonly agents: IAgentManager) {}

  async execute(
    payload: Params,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<SearchAgentsResponse>> {
    const results = await this.agents.searchAgentsAsync(payload as any);
    return { status: 'ok', data: { results, totalCount: results.length } };
  }
}
