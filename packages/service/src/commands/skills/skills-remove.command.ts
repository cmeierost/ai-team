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
import { removeSkillCommand } from './skills.js';

type Params = z.infer<typeof SkillsRemoveCommand.schema>;
const _skillsRemoveCommandSchema = z.object({
  agent: z.string().describe('Agent id, name, or role query'),
  skill: z.string().describe('Skill name to remove'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export const SkillsRemoveCommandMetadata = {
  key: 'remove',
  description: 'Remove a skill from an agent',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'skills',
  parameters: _skillsRemoveCommandSchema,
} satisfies ICommandDescriptor;

export class SkillsRemoveCommand implements ICommand<Params, UpdateAgentSkillResponse> {
  static readonly schema = _skillsRemoveCommandSchema;
  readonly metadata = SkillsRemoveCommandMetadata;

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
