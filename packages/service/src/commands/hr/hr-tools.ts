import { z } from 'zod';
import type {
  ExecutionContext,
  AgentConfig,
  IAgentManager,
  IAvatarManager,
  IConfigurationStorage,
  CommandResponse,
} from '@ai-team/core';
import { ContextLevel } from '@ai-team/core';

function ok<T>(data: T): CommandResponse<T> {
  return { status: 'ok', data };
}

// ─── CreateAgent ──────────────────────────────────────────────────────────────

export interface CreateAgentParams {
  name: string;
  role: string;
  specializations?: string[];
  reportsTo?: string;
}

export interface CreateAgentResult {
  agentId: string;
  name: string;
  role: string;
  reportsTo?: string;
  filePath: string;
}

export class CreateAgentTool {
  readonly name = 'create_agent';
  readonly key = 'create_agent';
  readonly group = 'hr';
  readonly availableIn = { tool: true };
  readonly description =
    'Create a new virtual team member with a defined role. ' +
    'Requires organization-level context.';
  readonly parameters = z.object({
    name: z.string().min(1).describe('Full name of the new team member'),
    role: z.string().min(1).describe('Job role / title'),
    specializations: z.array(z.string()).optional().describe('Areas of expertise'),
    reportsTo: z.string().optional().describe('Agent ID of the direct manager'),
  });

  constructor(private readonly agentManager: IAgentManager) {}

  async execute(
    params: CreateAgentParams,
    context: ExecutionContext
  ): Promise<CommandResponse<CreateAgentResult>> {
    if ((context as any).agent?.contextLevel !== 'organization') {
      throw new Error('create_agent requires organization-level context.');
    }

    const currentAgent = context.agent;
    if (!currentAgent) {
      throw new Error('create_agent requires an active agent context.');
    }

    const { name, role, specializations = [], reportsTo } = params;
    const config: AgentConfig = {
      name,
      role,
      specializations,
      reportsTo: reportsTo ?? currentAgent.id,
      contextLevel: ContextLevel.MODULE,
    };

    const created = await this.agentManager.createAgentAsync(config);

    return ok({
      agentId: created.id,
      name: created.name,
      role: created.role,
      reportsTo: created.reportsTo,
      filePath: created.filePath,
    });
  }
}

// ─── ArchiveAgent ─────────────────────────────────────────────────────────────

export interface ArchiveAgentParams {
  employee: string;
}

export interface ArchiveAgentResult {
  agentId: string;
  name: string;
  archived: boolean;
}

export class ArchiveAgentTool {
  readonly name = 'archive';
  readonly key = 'archive';
  readonly group = 'hr';
  readonly availableIn = { tool: true };
  readonly description = 'Archive (soft-delete) a team member. Requires manage_agents permission.';
  readonly parameters = z.object({
    employee: z.string().min(1).describe('Agent name, ID, or role to archive'),
  });

  constructor(private readonly agentManager: IAgentManager) {}

  async execute(
    params: ArchiveAgentParams,
    context: ExecutionContext
  ): Promise<CommandResponse<ArchiveAgentResult>> {
    const { employee } = params;
    const currentAgent = context.agent;
    if (!currentAgent) {
      throw new Error('archive requires an active agent context.');
    }

    const matches = await this.agentManager.resolveAgentAsync(employee.trim());
    if (matches.length === 0) throw new Error(`No employee found matching '${employee}'.`);
    if (matches.length > 1) {
      throw new Error(`Multiple employees match '${employee}'. Be more specific.`);
    }

    const target = matches[0];
    const canManage =
      (context as any).agent?.contextLevel === 'organization' ||
      target.reportsTo === currentAgent.id;

    if (!canManage) {
      throw new Error(`You do not have permission to archive ${target.id}.`);
    }

    await this.agentManager.archiveAgentAsync(target.id);

    return ok({ agentId: target.id, name: target.name, archived: true });
  }
}

// ─── AssessPerformance ────────────────────────────────────────────────────────

export interface AssessPerformanceParams {
  agent?: string;
}

export interface AssessPerformanceResult {
  assessments: Array<{
    agentId: string;
    name: string;
    role: string;
    status: string;
    reportsTo?: string;
  }>;
}

export class AssessPerformanceTool {
  readonly name = 'performance';
  readonly key = 'performance';
  readonly group = 'hr';
  readonly availableIn = { tool: true };
  readonly description =
    'Assess the status of direct reports (or a specific agent). ' +
    "Returns a snapshot of each team member's current status.";
  readonly parameters = z.object({
    agent: z
      .string()
      .optional()
      .describe('Optional agent name/id/role to assess (defaults to all direct reports)'),
  });

  constructor(private readonly agentManager: IAgentManager) {}

  async execute(
    params: AssessPerformanceParams,
    context: ExecutionContext
  ): Promise<CommandResponse<AssessPerformanceResult>> {
    const { agent } = params;
    const currentAgent = context.agent;
    if (!currentAgent) {
      throw new Error('performance requires an active agent context.');
    }

    let targets = agent?.trim()
      ? await this.agentManager.resolveAgentAsync(agent.trim())
      : await this.agentManager.getDirectReportsAsync(currentAgent.id);

    if (agent && targets.length === 0) {
      throw new Error(`No agent found matching '${agent}'.`);
    }

    return ok({
      assessments: targets.map((a) => ({
        agentId: a.id,
        name: a.name,
        role: a.role,
        status: (a as any).status ?? 'active',
        reportsTo: a.reportsTo,
      })),
    });
  }
}

// ─── AddPicture ───────────────────────────────────────────────────────────────

export interface AddPictureParams {
  agent: string;
  prompt?: string;
  urlTemplate?: string;
  provider?: string;
  modelName?: string;
  apiKey?: string;
}

export interface AddPictureResult {
  agentId: string;
  name: string;
  avatarPath: string;
  updated: boolean;
}

export class AddPictureTool {
  readonly name = 'avatar';
  readonly key = 'avatar';
  readonly group = 'hr';
  readonly availableIn = { tool: true };
  readonly description =
    'Generate or assign an avatar image for a team member. ' +
    'Supports AI generation, random download via URL template, or custom prompt.';
  readonly parameters = z.object({
    agent: z.string().min(1).describe('Agent name, ID, or role'),
    prompt: z.string().optional().describe('Custom prompt for AI-generated avatar'),
    urlTemplate: z.string().optional().describe('URL template for downloading a random avatar'),
    provider: z.string().optional().describe('LLM provider for AI generation'),
    modelName: z.string().optional().describe('Model name for AI generation'),
    apiKey: z.string().optional().describe('API key for AI generation'),
  });

  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly avatarManager: IAvatarManager,
    private readonly configStorage: IConfigurationStorage
  ) {}

  async execute(
    params: AddPictureParams,
    context: ExecutionContext
  ): Promise<CommandResponse<AddPictureResult>> {
    const { agent, prompt, urlTemplate, provider, modelName, apiKey } = params;

    const matches = await this.agentManager.resolveAgentAsync(agent.trim());
    if (matches.length === 0) throw new Error(`No agent found matching '${agent}'.`);
    if (matches.length > 1) {
      throw new Error(`Multiple agents match '${agent}'. Be more specific.`);
    }

    const target = matches[0];
    let imageData: Buffer;

    if (urlTemplate) {
      imageData = await this.avatarManager.downloadRandomAvatar(urlTemplate, target);
    } else if (prompt && provider && modelName && apiKey) {
      imageData = await this.avatarManager.generateAvatarWithAI(
        prompt,
        { provider } as any,
        modelName,
        apiKey
      );
    } else {
      const teamConfig = await this.configStorage.loadTeamConfigAsync(this.workspaceRoot);
      const templateUrl = (teamConfig as any)?.avatarUrlTemplate;
      if (templateUrl) {
        imageData = await this.avatarManager.downloadRandomAvatar(templateUrl, target);
      } else {
        const builtPrompt = this.avatarManager.buildAvatarPrompt(target);
        const config = await this.configStorage.loadEffectiveConfigAsync(this.workspaceRoot);
        const llmConfig = config?.llm as any;
        if (!llmConfig)
          throw new Error('No LLM config or URL template available for avatar generation.');
        imageData = await this.avatarManager.generateAvatarWithAI(
          builtPrompt,
          llmConfig,
          llmConfig.model ?? llmConfig.modelKey ?? 'gpt-4o',
          llmConfig.apiKey ?? ''
        );
      }
    }

    await this.avatarManager.saveAvatarPreview(target.name, imageData, this.workspaceRoot);
    const avatarRelPath = await this.avatarManager.finalizeAvatar(
      target.name,
      this.workspaceRoot
    );
    await this.avatarManager.updateAgentAvatar(target, avatarRelPath, this.workspaceRoot);

    return ok({
      agentId: target.id,
      name: target.name,
      avatarPath: avatarRelPath,
      updated: true,
    });
  }
}
