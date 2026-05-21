import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ISkillManager,
  IMarkdownSectionService,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { UpdateAgentSkillResponse } from '@ai-team/api-contracts';
import { addSkillCommand } from './skills.js';

type Params = z.infer<typeof SkillsAddCommand.schema>;
const _skillsAddCommandSchema = z.object({
  agent: z.string().describe('Agent id, name, or role query'),
  skill: z.string().describe('Skill name to add'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export const SkillsAddCommandMetadata = {
  key: 'skillsAdd',
  cli: { command: 'add', parentKey: 'skills' },
  description: 'Add a skill to an agent',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'skills',
  parameters: _skillsAddCommandSchema,
} satisfies ICommandDescriptor;

export class SkillsAddCommand implements ICommand<Params, UpdateAgentSkillResponse> {
  static readonly schema = _skillsAddCommandSchema;
  readonly metadata = SkillsAddCommandMetadata;

  constructor(
    private readonly agents: IAgentManager,
    private readonly skills: ISkillManager,
    private readonly markdown: IMarkdownSectionService
  ) {}

  async execute(
    payload: Params,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<UpdateAgentSkillResponse>> {
    const data = await addSkillCommand(this.agents, this.skills, this.markdown, {
      agent: payload.agent,
      skill: payload.skill,
    });
    return { status: 'ok', data };
  }
}
