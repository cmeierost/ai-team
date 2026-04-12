import type {
  ISkillsService,
  SearchSkillsResponse,
  UpdateAgentSkillResponse,
} from '@ai-team/api-client';
import type { AgentManager, SkillManager } from '@ai-team/infrastructure';
import { searchSkillsCommand, addSkillCommand, removeSkillCommand } from '../commands/skills.js';
import { BadRequestError } from '../http-errors.js';

export class SkillsService implements ISkillsService {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly skillManager: SkillManager
  ) {}

  async search(query?: { q?: string; agent?: string }): Promise<SearchSkillsResponse> {
    return searchSkillsCommand(this.agentManager, this.skillManager, {
      query: query?.q,
      agent: query?.agent,
    });
  }

  async add(body: { agent: string; skill: string }): Promise<UpdateAgentSkillResponse> {
    if (!body.agent || !body.skill) throw new BadRequestError('agent and skill are required');
    return addSkillCommand(this.agentManager, this.skillManager, body);
  }

  async remove(body: { agent: string; skill: string }): Promise<UpdateAgentSkillResponse> {
    if (!body.agent || !body.skill) throw new BadRequestError('agent and skill are required');
    return removeSkillCommand(this.agentManager, this.skillManager, body);
  }
}
