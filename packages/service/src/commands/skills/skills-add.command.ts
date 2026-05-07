import { z } from 'zod';
import type {
  ICommand,
  CommandRuntime,
  IAgentManager,
  ISkillManager,
  IMarkdownSectionService,
} from '@ai-team/core';
import type { UpdateAgentSkillResponse } from '@ai-team/api-contracts';
import { addSkillCommand } from './skills.js';

type Params = z.infer<typeof SkillsAddCommand.schema>;

export class SkillsAddCommand implements ICommand<Params, void, UpdateAgentSkillResponse> {
  static readonly schema = z.object({
    agent: z.string().describe('Agent id, name, or role query'),
    skill: z.string().describe('Skill name to add'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'skillsAdd';
  readonly cli = { command: 'add', parentKey: 'skills' };
  readonly description = 'Add a skill to an agent';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = SkillsAddCommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly skills: ISkillManager,
    private readonly markdown: IMarkdownSectionService
  ) {}

  async execute(
    payload: Params,
    _ctx: void,
    _runtime: CommandRuntime
  ): Promise<UpdateAgentSkillResponse> {
    return addSkillCommand(this.agents, this.skills, this.markdown, {
      agent: payload.agent,
      skill: payload.skill,
    });
  }
}
