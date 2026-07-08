import type {
  IToolsService,
  ListToolsResponse,
  UpdateAgentToolResponse,
} from '@ai-team/api-contracts';
import { BadRequestError } from '@ai-team/core';
import { AgentToolsService } from '../commands/tools/tools-service.js';
import { GovernanceService } from '../governance/governance-service.js';

export class ToolsService implements IToolsService {
  constructor(
    private readonly agentToolsService: AgentToolsService,
    private readonly governanceService: GovernanceService
  ) {}

  async list(query?: { agent?: string }): Promise<ListToolsResponse> {
    return this.agentToolsService.list({ agent: query?.agent });
  }

  async allow(body: { agent: string; tool: string }): Promise<UpdateAgentToolResponse> {
    if (!body.agent || !body.tool) throw new BadRequestError('agent and tool are required');
    return this.agentToolsService.allow(body);
  }

  async disallow(body: { agent: string; tool: string }): Promise<UpdateAgentToolResponse> {
    if (!body.agent || !body.tool) throw new BadRequestError('agent and tool are required');
    return this.agentToolsService.disallow(body);
  }

  async toolAllow(body: {
    agent: string;
    tool: string;
    requestedBy: string;
    approvedByUser: boolean;
  }): Promise<UpdateAgentToolResponse> {
    const actor = await this.governanceService.resolveGovernanceActor(
      body.requestedBy,
      'tool_allow'
    );
    this.governanceService.assertDefaultGovernancePolicy(actor);
    await this.governanceService.requireUserApproval(
      {
        requestedBy: body.requestedBy,
        confirmUserApproval: async () => body.approvedByUser,
      },
      `Approve tool_allow by ${actor.name} (${actor.id}) for target agent '${body.agent}' and tool '${body.tool}'?`
    );
    return this.agentToolsService.allow({ agent: body.agent, tool: body.tool });
  }

  async toolDeny(body: {
    agent: string;
    tool: string;
    requestedBy: string;
    approvedByUser: boolean;
  }): Promise<UpdateAgentToolResponse> {
    const actor = await this.governanceService.resolveGovernanceActor(
      body.requestedBy,
      'tool_deny'
    );
    this.governanceService.assertDefaultGovernancePolicy(actor);
    await this.governanceService.requireUserApproval(
      {
        requestedBy: body.requestedBy,
        confirmUserApproval: async () => body.approvedByUser,
      },
      `Approve tool_deny by ${actor.name} (${actor.id}) for target agent '${body.agent}' and tool '${body.tool}'?`
    );
    return this.agentToolsService.disallow({ agent: body.agent, tool: body.tool });
  }
}
