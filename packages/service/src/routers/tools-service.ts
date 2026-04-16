import type {
  IToolsService,
  ListToolsResponse,
  UpdateAgentToolResponse,
} from '@ai-team/api-client';
import type { AgentManager } from '@ai-team/infrastructure';
import type { ToolManager } from '../tools/tool-manager.js';
import type { IMcpGateway } from '../orchestrator/pipeline.js';
import {
  listToolsCommand,
  allowToolCommand,
  disallowToolCommand,
  toolAllowCommand,
  toolDenyCommand,
} from '../commands/tools.js';
import { BadRequestError } from '../http-errors.js';

export class ToolsService implements IToolsService {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly toolManager: ToolManager,
    private readonly mcpGateway?: IMcpGateway
  ) {}

  async list(query?: { agent?: string }): Promise<ListToolsResponse> {
    return listToolsCommand(
      this.agentManager,
      this.toolManager,
      { agent: query?.agent },
      this.mcpGateway
    );
  }

  async allow(body: { agent: string; tool: string }): Promise<UpdateAgentToolResponse> {
    if (!body.agent || !body.tool) throw new BadRequestError('agent and tool are required');
    return allowToolCommand(this.agentManager, this.toolManager, body);
  }

  async disallow(body: { agent: string; tool: string }): Promise<UpdateAgentToolResponse> {
    if (!body.agent || !body.tool) throw new BadRequestError('agent and tool are required');
    return disallowToolCommand(this.agentManager, this.toolManager, body);
  }

  async toolAllow(body: {
    agent: string;
    tool: string;
    requestedBy: string;
    approvedByUser: boolean;
  }): Promise<UpdateAgentToolResponse> {
    return toolAllowCommand(
      this.agentManager,
      this.toolManager,
      { agent: body.agent, tool: body.tool },
      { requestedBy: body.requestedBy, confirmUserApproval: async () => body.approvedByUser }
    );
  }

  async toolDeny(body: {
    agent: string;
    tool: string;
    requestedBy: string;
    approvedByUser: boolean;
  }): Promise<UpdateAgentToolResponse> {
    return toolDenyCommand(
      this.agentManager,
      this.toolManager,
      { agent: body.agent, tool: body.tool },
      { requestedBy: body.requestedBy, confirmUserApproval: async () => body.approvedByUser }
    );
  }
}
