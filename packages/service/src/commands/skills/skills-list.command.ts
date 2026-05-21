import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ISkillManager,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SearchSkillsResponse } from '@ai-team/api-contracts';
import { searchSkillsCommand } from './skills.js';

type Params = z.infer<typeof SkillsListCommand.schema>;
const _skillsListCommandSchema = z.object({
  query: z.string().optional().describe('Filter by name, description, responsibility, or tool'),
  agent: z.string().optional().describe('Annotate assignment state for a specific agent'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export const SkillsListCommandMetadata = {
  key: 'skillsList',
  cli: { command: 'skills' },
  description: 'Search available skills and optionally show whether they are assigned to an agent',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'skills',
  parameters: _skillsListCommandSchema,
} satisfies ICommandDescriptor;

export class SkillsListCommand implements ICommand<Params, SearchSkillsResponse> {
  static readonly schema = _skillsListCommandSchema;
  readonly metadata = SkillsListCommandMetadata;

  constructor(
    private readonly agents: IAgentManager,
    private readonly skills: ISkillManager
  ) {}

  async execute(
    payload: Params,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<SearchSkillsResponse>> {
    const data = await searchSkillsCommand(this.agents, this.skills, {
      query: payload.query,
      agent: payload.agent,
    });
    return { status: 'ok', data };
  }
}
