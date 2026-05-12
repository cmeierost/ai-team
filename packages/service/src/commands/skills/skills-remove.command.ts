import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ISkillManager,
  IMarkdownSectionService,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { UpdateAgentSkillResponse } from '@ai-team/api-contracts';
import { removeSkillCommand } from './skills.js';

type Params = z.infer<typeof SkillsRemoveCommand.schema>;

export class SkillsRemoveCommand implements ICommand<Params, UpdateAgentSkillResponse> {
  static readonly schema = z.object({
    agent: z.string().describe('Agent id, name, or role query'),
    skill: z.string().describe('Skill name to remove'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'skillsRemove';
  readonly cli = { command: 'remove', parentKey: 'skills' };
  readonly description = 'Remove a skill from an agent';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'skills';
  readonly parameters = SkillsRemoveCommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly skills: ISkillManager,
    private readonly markdown: IMarkdownSectionService
  ) {}

  async execute(
    payload: Params,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<UpdateAgentSkillResponse>> {
    const data = await removeSkillCommand(this.agents, this.skills, this.markdown, {
      agent: payload.agent,
      skill: payload.skill,
    });
    return { status: 'ok', data };
  }
}
