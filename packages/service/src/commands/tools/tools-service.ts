import type {
  Agent,
  IAgentManager,
  ICommand,
  ICommandDescriptor,
  ExecutionContext,
} from '@ai-team/core';
import type { ToolManager } from '../../tooling/manager/tool-manager.js';
import { ToolIdentity } from '../../tooling/manager/tool-manager.js';
import type { ListToolsResponse, UpdateAgentToolResponse } from '@ai-team/api-contracts';
import type { IMcpGateway } from '../../workflow/runtime/pipeline.js';
import { GovernanceService } from '../../governance/governance-service.js';

export interface ListToolsOptions {
  agent?: string;
}

export interface UpdateAgentToolOptions {
  agent: string;
  tool: string;
}

export class AgentToolsService {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly toolManager: ToolManager,
    private readonly governanceService: GovernanceService,
    private readonly mcpGateway?: IMcpGateway
  ) {}

  async list(options: ListToolsOptions = {}): Promise<ListToolsResponse> {
    const [staticTools, mcpTools] = await Promise.all([
      Promise.resolve(this.sortDescriptorsByName(this.toolManager.getAll())),
      this.mcpGateway ? this.mcpGateway.discover() : Promise.resolve([] as ICommand[]),
    ]);

    if (!options.agent) {
      const mcpEntries = mcpTools.map((tool) => ({
        ...this.buildCatalogEntry(tool.metadata),
        allowedForAgent: true,
      }));
      return {
        entries: [...staticTools.map((meta) => this.buildCatalogEntry(meta)), ...mcpEntries],
        timestamp: new Date().toISOString(),
      };
    }

    const agent = await this.resolveFullAgent(options.agent, 'list tools for agent');
    const staticEntries = await Promise.all(
      staticTools.map(async (meta) => {
        const permission = await this.toolManager.canExecute(agent, ToolIdentity.key(meta), {});
        return {
          ...this.buildCatalogEntry(meta),
          allowedForAgent: permission.allowed,
          deniedReason: permission.allowed ? undefined : permission.reason,
        };
      })
    );
    const mcpEntries = mcpTools.map((tool) => ({
      ...this.buildCatalogEntry(tool.metadata),
      allowedForAgent: true,
    }));

    return {
      entries: [...staticEntries, ...mcpEntries],
      timestamp: new Date().toISOString(),
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
      },
    };
  }

  async allow(options: UpdateAgentToolOptions): Promise<UpdateAgentToolResponse> {
    const resolved = await this.agentManager.resolveAgentForOperationAsync(
      options.agent,
      'allow tool'
    );
    const agent = await this.agentManager.getAgentAsync(resolved.id);
    if (!agent) {
      throw new Error(`Agent not found: ${resolved.id}`);
    }

    const resolvedTool = this.resolveToolIdentifier(options.tool);

    const currentTools = agent.tools ?? [];
    const currentDenied = agent.disallowedTools ?? [];
    const toolAllowed = currentTools.includes(resolvedTool);
    const toolDenied = currentDenied.includes(resolvedTool);

    const nextTools = toolAllowed
      ? currentTools
      : [...currentTools, resolvedTool].sort((a, b) => a.localeCompare(b));
    const nextDenied = currentDenied.filter((t) => t !== resolvedTool);
    const changed = !toolAllowed || toolDenied;

    const updatedAgent = changed
      ? await this.agentManager.updateAgentAsync(agent.id, {
          tools: nextTools,
          disallowedTools: nextDenied.length > 0 ? nextDenied : undefined,
        })
      : agent;

    return {
      agent: {
        id: updatedAgent.id,
        name: updatedAgent.name,
        role: updatedAgent.role,
      },
      tool: resolvedTool,
      tools: updatedAgent.tools ?? nextTools,
      changed,
    };
  }

  async disallow(options: UpdateAgentToolOptions): Promise<UpdateAgentToolResponse> {
    const resolved = await this.agentManager.resolveAgentForOperationAsync(
      options.agent,
      'disallow tool'
    );
    const agent = await this.agentManager.getAgentAsync(resolved.id);
    if (!agent) {
      throw new Error(`Agent not found: ${resolved.id}`);
    }

    const resolvedTool = this.resolveToolIdentifier(options.tool);

    const currentTools = agent.tools ?? [];
    const currentDenied = agent.disallowedTools ?? [];
    const nextTools = currentTools.filter((t) => t !== resolvedTool);
    const alreadyDenied = currentDenied.includes(resolvedTool);
    const nextDenied = alreadyDenied
      ? currentDenied
      : [...currentDenied, resolvedTool].sort((a, b) => a.localeCompare(b));
    const changed = nextTools.length !== currentTools.length || !alreadyDenied;

    const updatedAgent = changed
      ? await this.agentManager.updateAgentAsync(agent.id, {
          tools: nextTools.length > 0 ? nextTools : undefined,
          disallowedTools: nextDenied,
        })
      : agent;

    return {
      agent: {
        id: updatedAgent.id,
        name: updatedAgent.name,
        role: updatedAgent.role,
      },
      tool: resolvedTool,
      tools: updatedAgent.tools ?? nextTools,
      changed,
    };
  }

  async governedAllow(
    ctx: ExecutionContext,
    payload: { agent: string; tool: string; requestedBy?: string; approvedByUser?: boolean }
  ): Promise<UpdateAgentToolResponse> {
    const requestedBy = await this.governanceService.resolveRequestedByFromRuntime(
      ctx,
      payload.requestedBy,
      'requestedBy is required for tool governance'
    );
    const actor = await this.governanceService.resolveGovernanceActor(requestedBy, 'tool_allow');
    this.governanceService.assertDefaultGovernancePolicy(actor);
    await this.governanceService.requireUserApproval(
      {
        requestedBy,
        confirmUserApproval: (msg) =>
          this.governanceService.confirmGovernanceActionFromRuntime(
            ctx,
            payload.approvedByUser,
            msg
          ),
      },
      `Approve tool_allow by ${actor.name} (${actor.id}) for target agent '${payload.agent}' and tool '${payload.tool}'?`
    );
    return this.allow({ agent: payload.agent, tool: payload.tool });
  }

  async governedDeny(
    ctx: ExecutionContext,
    payload: { agent: string; tool: string; requestedBy?: string; approvedByUser?: boolean }
  ): Promise<UpdateAgentToolResponse> {
    const requestedBy = await this.governanceService.resolveRequestedByFromRuntime(
      ctx,
      payload.requestedBy,
      'requestedBy is required for tool governance'
    );
    const actor = await this.governanceService.resolveGovernanceActor(requestedBy, 'tool_deny');
    this.governanceService.assertDefaultGovernancePolicy(actor);
    await this.governanceService.requireUserApproval(
      {
        requestedBy,
        confirmUserApproval: (msg) =>
          this.governanceService.confirmGovernanceActionFromRuntime(
            ctx,
            payload.approvedByUser,
            msg
          ),
      },
      `Approve tool_deny by ${actor.name} (${actor.id}) for target agent '${payload.agent}' and tool '${payload.tool}'?`
    );
    return this.disallow({ agent: payload.agent, tool: payload.tool });
  }

  private resolveToolIdentifier(requestedTool: string): string {
    const normalizedRequestedTool = requestedTool.trim();
    if (!normalizedRequestedTool) {
      throw new Error('Tool selector cannot be empty.');
    }

    if (normalizedRequestedTool.includes('*')) {
      const hasMatch = this.toolManager
        .getAll()
        .some((meta) => ToolIdentity.matchesSelector(normalizedRequestedTool, meta));
      if (!hasMatch) {
        throw new Error(`Unknown tool: ${normalizedRequestedTool}`);
      }
      return normalizedRequestedTool;
    }

    if (this.toolManager.get(normalizedRequestedTool)) {
      return normalizedRequestedTool;
    }

    throw new Error(`Unknown tool: ${normalizedRequestedTool}`);
  }

  private async resolveFullAgent(query: string, operation: string): Promise<Agent> {
    const resolved = await this.agentManager.resolveAgentForOperationAsync(query, operation);
    const agent = await this.agentManager.getAgentAsync(resolved.id);
    if (!agent) {
      throw new Error(`Agent not found: ${resolved.id}`);
    }
    return agent;
  }

  private buildCatalogEntry(meta: ICommandDescriptor) {
    const key = ToolIdentity.key(meta);
    const permType = meta.permissionCheck?.type;
    return {
      name: key,
      description: meta.description,
      group: meta.group,
      schema: this.toolManager.toSchema(key)?.parameters ?? {},
      tags: meta.tags,
      examples: meta.examples,
      fileRightsDependent: permType === 'file-read' || permType === 'file-write',
    };
  }

  private sortDescriptorsByName(descs: ICommandDescriptor[]): ICommandDescriptor[] {
    return [...descs].sort((a, b) => ToolIdentity.key(a).localeCompare(ToolIdentity.key(b)));
  }
}
