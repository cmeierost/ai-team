import type {
  ISkillsService,
  SearchSkillsResponse,
  UpdateAgentSkillResponse,
} from '@ai-team/api-contracts';
import type { IAgentManager, ISkillManager, IMarkdownSectionService } from '@ai-team/core';
import {
  searchSkillsCommand,
  addSkillCommand,
  removeSkillCommand,
} from '../commands/skills/skills.js';
import { BadRequestError } from '@ai-team/core';

export class SkillsService implements ISkillsService {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly skillManager: ISkillManager,
    private readonly markdownSvc: IMarkdownSectionService
  ) {}

  async search(query?: { q?: string; agent?: string }): Promise<SearchSkillsResponse> {
    return searchSkillsCommand(this.agentManager, this.skillManager, {
      query: query?.q,
      agent: query?.agent,
    });
  }

  async add(body: { agent: string; skill: string }): Promise<UpdateAgentSkillResponse> {
    if (!body.agent || !body.skill) throw new BadRequestError('agent and skill are required');
    return addSkillCommand(this.agentManager, this.skillManager, this.markdownSvc, body);
  }

  async remove(body: { agent: string; skill: string }): Promise<UpdateAgentSkillResponse> {
    if (!body.agent || !body.skill) throw new BadRequestError('agent and skill are required');
    return removeSkillCommand(this.agentManager, this.skillManager, this.markdownSvc, body);
  }
}
