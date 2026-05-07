import { z } from 'zod';
import type { ICommand, CommandRuntime, IAgentManager, ISkillManager } from '@ai-team/core';
import type { SearchSkillsResponse } from '@ai-team/api-contracts';
import { searchSkillsCommand } from './skills.js';

type Params = z.infer<typeof SkillsListCommand.schema>;

export class SkillsListCommand implements ICommand<Params, void, SearchSkillsResponse> {
  static readonly schema = z.object({
    query: z.string().optional().describe('Filter by name, description, responsibility, or tool'),
    agent: z.string().optional().describe('Annotate assignment state for a specific agent'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'skillsList';
  readonly cli = { command: 'skills' };
  readonly description =
    'Search available skills and optionally show whether they are assigned to an agent';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = SkillsListCommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly skills: ISkillManager
  ) {}

  async execute(
    payload: Params,
    _ctx: void,
    _runtime: CommandRuntime
  ): Promise<SearchSkillsResponse> {
    return searchSkillsCommand(this.agents, this.skills, {
      query: payload.query,
      agent: payload.agent,
    });
  }
}
