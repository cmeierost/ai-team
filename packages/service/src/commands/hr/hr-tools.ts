import { z } from 'zod';
import type {
  AgentTool,
  ITool,
  ToolContext,
  AgentConfig,
  IAgentManager,
} from '@ai-team/core';
import { ContextLevel, TOOL_SERVICE_TOKENS as T } from '@ai-team/core';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveAgentManager(context: ToolContext): IAgentManager {
  if (!context.resolve) throw new Error('ToolContext.resolve is required.');
  return context.resolve(T.AgentManager);
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

export class CreateAgentTool implements ITool<CreateAgentParams, ToolContext, CreateAgentResult> {
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

  async execute(params: CreateAgentParams, context: ToolContext): Promise<CreateAgentResult> {
    if ((context as any).agent?.contextLevel !== 'organization') {
      throw new Error('create_agent requires organization-level context.');
    }

    const { name, role, specializations = [], reportsTo } = params;
    const agentManager = resolveAgentManager(context);

    const config: AgentConfig = {
      name,
      role,
      specializations,
      reportsTo: reportsTo ?? context.agent.id,
      contextLevel: ContextLevel.MODULE,
    };

    const created = await agentManager.createAgentAsync(config);

    return {
      agentId: created.id,
      name: created.name,
      role: created.role,
      reportsTo: created.reportsTo,
      filePath: created.filePath,
    };
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

export class ArchiveAgentTool implements ITool<ArchiveAgentParams, ToolContext, ArchiveAgentResult> {
  readonly name = 'archive';
  readonly key = 'archive';
  readonly group = 'hr';
  readonly availableIn = { tool: true };
  readonly description = 'Archive (soft-delete) a team member. Requires manage_agents permission.';
  readonly parameters = z.object({
    employee: z.string().min(1).describe('Agent name, ID, or role to archive'),
  });

  async execute(params: ArchiveAgentParams, context: ToolContext): Promise<ArchiveAgentResult> {
    const { employee } = params;
    const agentManager = resolveAgentManager(context);

    const matches = await agentManager.resolveAgentAsync(employee.trim());
    if (matches.length === 0) throw new Error(`No employee found matching '${employee}'.`);
    if (matches.length > 1) {
      throw new Error(`Multiple employees match '${employee}'. Be more specific.`);
    }

    const target = matches[0];
    const canManage =
      (context as any).agent?.contextLevel === 'organization' ||
      target.reportsTo === context.agent.id;

    if (!canManage) {
      throw new Error(`You do not have permission to archive ${target.id}.`);
    }

    await agentManager.archiveAgentAsync(target.id);

    return { agentId: target.id, name: target.name, archived: true };
  }
}

// ─── AssessPerformance ────────────────────────────────────────────────────────

export interface AssessPerformanceParams {
  employee?: string;
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

export class AssessPerformanceTool
  implements ITool<AssessPerformanceParams, ToolContext, AssessPerformanceResult>
{
  readonly name = 'performance';
  readonly key = 'performance';
  readonly group = 'hr';
  readonly availableIn = { tool: true };
  readonly description =
    'Assess the status of direct reports (or a specific employee). ' +
    "Returns a snapshot of each team member's current status.";
  readonly parameters = z.object({
    employee: z
      .string()
      .optional()
      .describe('Optional employee name/id/role to assess (defaults to all direct reports)'),
  });

  async execute(
    params: AssessPerformanceParams,
    context: ToolContext
  ): Promise<AssessPerformanceResult> {
    const { employee } = params;
    const agentManager = resolveAgentManager(context);

    let targets = employee?.trim()
      ? await agentManager.resolveAgentAsync(employee.trim())
      : await agentManager.getDirectReportsAsync(context.agent.id);

    if (employee && targets.length === 0) {
      throw new Error(`No employee found matching '${employee}'.`);
    }

    return {
      assessments: targets.map((a) => ({
        agentId: a.id,
        name: a.name,
        role: a.role,
        status: (a as any).status ?? 'active',
        reportsTo: a.reportsTo,
      })),
    };
  }
}

// ─── AddPicture ───────────────────────────────────────────────────────────────

export interface AddPictureParams {
  employee: string;
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

export class AddPictureTool implements ITool<AddPictureParams, ToolContext, AddPictureResult> {
  readonly name = 'avatar';
  readonly key = 'avatar';
  readonly group = 'hr';
  readonly availableIn = { tool: true };
  readonly description =
    'Generate or assign an avatar image for a team member. ' +
    'Supports AI generation, random download via URL template, or custom prompt.';
  readonly parameters = z.object({
    employee: z.string().min(1).describe('Agent name, ID, or role'),
    prompt: z.string().optional().describe('Custom prompt for AI-generated avatar'),
    urlTemplate: z.string().optional().describe('URL template for downloading a random avatar'),
    provider: z.string().optional().describe('LLM provider for AI generation'),
    modelName: z.string().optional().describe('Model name for AI generation'),
    apiKey: z.string().optional().describe('API key for AI generation'),
  });

  async execute(params: AddPictureParams, context: ToolContext): Promise<AddPictureResult> {
    if (!context.resolve) throw new Error('ToolContext.resolve is required.');
    const { employee, prompt, urlTemplate, provider, modelName, apiKey } = params;

    const agentManager = context.resolve(T.AgentManager);
    const avatarManager = context.resolve(T.AvatarManager);
    const configStorage = context.resolve(T.ConfigurationStorage);

    const matches = await agentManager.resolveAgentAsync(employee.trim());
    if (matches.length === 0) throw new Error(`No employee found matching '${employee}'.`);
    if (matches.length > 1) {
      throw new Error(`Multiple employees match '${employee}'. Be more specific.`);
    }

    const target = matches[0];
    let imageData: Buffer;

    if (urlTemplate) {
      imageData = await avatarManager.downloadRandomAvatar(urlTemplate, target);
    } else if (prompt && provider && modelName && apiKey) {
      imageData = await avatarManager.generateAvatarWithAI(prompt, { provider } as any, modelName, apiKey);
    } else {
      const teamConfig = await configStorage.loadTeamConfigAsync(context.workspaceRoot);
      const templateUrl = (teamConfig as any)?.avatarUrlTemplate;
      if (!templateUrl) {
        const builtPrompt = avatarManager.buildAvatarPrompt(target);
        const config = await configStorage.loadEffectiveConfigAsync(context.workspaceRoot);
        const llmConfig = (config as any)?.llm;
        if (!llmConfig) throw new Error('No LLM config or URL template available for avatar generation.');
        imageData = await avatarManager.generateAvatarWithAI(
          builtPrompt,
          llmConfig,
          llmConfig.model ?? llmConfig.modelKey ?? 'gpt-4o',
          llmConfig.apiKey ?? ''
        );
      } else {
        imageData = await avatarManager.downloadRandomAvatar(templateUrl, target);
      }
    }

    await avatarManager.saveAvatarPreview(target.name, imageData, context.workspaceRoot);
    const avatarRelPath = await avatarManager.finalizeAvatar(target.name, context.workspaceRoot);
    await avatarManager.updateAgentAvatar(target, avatarRelPath, context.workspaceRoot);

    return {
      agentId: target.id,
      name: target.name,
      avatarPath: avatarRelPath,
      updated: true,
    };
  }
}

// ─── Module-level singletons ──────────────────────────────────────────────────

export const createAgentTool: AgentTool = new CreateAgentTool();
export const archiveAgentTool: AgentTool = new ArchiveAgentTool();
export const assessPerformanceTool: AgentTool = new AssessPerformanceTool();
export const addPictureTool: AgentTool = new AddPictureTool();
