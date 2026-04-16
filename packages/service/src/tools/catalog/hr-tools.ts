import { z } from 'zod';
import type { AgentTool, ToolContext } from '@ai-team/core';
import {
  loadTeamConfig,
  AgentManager,
  downloadRandomAvatar,
  generateAvatarWithAI,
  buildAvatarPrompt,
  saveAvatarPreview,
  finalizeAvatar,
  updateAgentAvatar,
} from '@ai-team/infrastructure';

/**
 * Create a new agent
 */
export const createAgentTool: AgentTool = {
  name: 'create_agent',
  group: 'hr',
  description: 'Create a new virtual team member. Requires manage_agents permission.',
  parameters: z.object({
    name: z.string(),
    role: z.string(),
    contextLevel: z.string(),
    reportsTo: z.string().optional(),
    features: z.array(z.string()).optional(),
  }),
  async execute(params, context: ToolContext) {
    if (context.agent.contextLevel !== 'organization') {
      throw new Error(`Agent ${context.agent.id} does not have permission to create agents`);
    }

    // Placeholder: Would call AgentManager.createAgentAsync()
    return {
      action: 'create_agent',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Archive an agent
 */
export const archiveAgentTool: AgentTool = {
  name: 'archive',
  group: 'hr',
  description: 'Archive (offboard) a virtual team member. Requires manage_agents permission.',
  parameters: z.object({
    agentId: z.string().describe('Agent ID to archive'),
    reason: z.string().optional().describe('Reason for archiving'),
  }),
  async execute(params, context: ToolContext) {
    if (context.agent.contextLevel !== 'organization') {
      throw new Error(`Agent ${context.agent.id} does not have permission to archive agents`);
    }

    return {
      action: 'hr_archive',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Assess agent performance
 */
export const assessPerformanceTool: AgentTool = {
  name: 'performance',
  group: 'hr',
  description: 'Analyze agent activity and performance metrics. Requires manage_agents permission.',
  parameters: z.object({
    agentId: z.string().optional().describe('Specific agent (omit for all)'),
    period: z.string().optional().describe('Time period (e.g., "last-30-days")'),
  }),
  async execute(params, context: ToolContext) {
    if (context.agent.contextLevel !== 'organization') {
      throw new Error(`Agent ${context.agent.id} does not have permission to assess performance`);
    }

    // Placeholder: Would analyze chat logs and meeting summaries
    return {
      action: 'analyze_performance',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

export const addPictureTool: AgentTool = {
  name: 'avatar',
  group: 'hr',
  description:
    'Download and set an avatar picture for an agent. Requires manage_agents permission. Can use random source or AI generation.',
  parameters: z.object({
    agentName: z.string().describe('Name or ID of the agent'),
    source: z
      .enum(['random', 'generate'])
      .default('random')
      .describe('Source: random (download) or generate (AI)'),
    randomUrlIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Index of random URL to use (defaults to first)'),
    prompt: z
      .string()
      .optional()
      .describe('Custom prompt for AI generation (auto-generated if omitted)'),
  }),
  async execute(params, context: ToolContext) {
    if (context.agent.contextLevel !== 'organization') {
      throw new Error(`Agent ${context.agent.id} does not have permission to add pictures`);
    }

    const { agentName, source, randomUrlIndex, prompt } = params as {
      agentName: string;
      source: 'random' | 'generate';
      randomUrlIndex?: number;
      prompt?: string;
    };

    // Resolve target agent
    const agentManager = new AgentManager(context.workspaceRoot);
    const targetAgent = await agentManager.resolveAgentOrThrowAsync(agentName);

    // Load team config
    const teamConfig = await loadTeamConfig(context.workspaceRoot);
    if (!teamConfig) {
      throw new Error('Team config not found. Run `ait init` first.');
    }
    let imageData: Buffer;

    if (source === 'random') {
      // Use random avatar URL
      const randomUrls = teamConfig.randomAvatarUrls || [];
      if (randomUrls.length === 0) {
        throw new Error('No random avatar URLs configured in .ai-team/config.json');
      }

      const urlIndex = randomUrlIndex ?? 0;
      if (urlIndex >= randomUrls.length) {
        throw new Error(
          `Random URL index ${urlIndex} out of range (max: ${randomUrls.length - 1})`
        );
      }

      const urlTemplate = randomUrls[urlIndex];
      imageData = await downloadRandomAvatar(urlTemplate, targetAgent);
    } else {
      // Generate with AI
      // Find first provider with imageModels configured
      const providers = teamConfig.providers || {};
      const imageCapableProviders = Object.entries(providers).filter(
        ([_, config]) => config.imageModels && Object.keys(config.imageModels).length > 0
      );

      if (imageCapableProviders.length === 0) {
        throw new Error('No providers with imageModels configured in .ai-team/config.json');
      }

      // Use first image-capable provider
      const [_providerName, providerConfig] = imageCapableProviders[0];
      const modelName = Object.values(providerConfig.imageModels!)[0];

      // Get API key from environment
      const apiKeyVar = providerConfig.apiKeyEnvVar || 'OPENAI_API_KEY';
      const apiKey = process.env[apiKeyVar];
      if (!apiKey) {
        throw new Error(`API key not found in environment variable: ${apiKeyVar}`);
      }

      // Generate prompt if not provided
      const finalPrompt = prompt || buildAvatarPrompt(targetAgent);

      imageData = await generateAvatarWithAI(finalPrompt, providerConfig, modelName, apiKey);
    }

    // Save and finalize avatar
    await saveAvatarPreview(targetAgent.id, imageData, context.workspaceRoot);
    const avatarPath = await finalizeAvatar(targetAgent.id, context.workspaceRoot);
    await updateAgentAvatar(targetAgent, avatarPath, context.workspaceRoot);

    return {
      action: 'hr_avatar',
      agentName: targetAgent.name,
      source,
      avatarPath,
      timestamp: new Date().toISOString(),
    };
  },
};
