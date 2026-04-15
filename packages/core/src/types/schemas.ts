import { z } from 'zod';
import { ContextLevel, RoleType } from './taxonomy.js';

export const AvatarConfigSchema = z.object({
  type: z.enum(['ai-generated', 'url', 'initials']),
  seed: z.string().optional(),
  url: z.string().optional(),
  style: z.enum(['professional-headshot', 'avatar', 'illustrated']).optional(),
  color: z.string().optional(),
});

export const PersonalityConfigSchema = z.object({
  communication_style: z
    .enum(['collaborative', 'direct', 'supportive', 'analytical', 'strategic'])
    .optional(),
  expertise_level: z.enum(['executive', 'senior', 'mid-level', 'junior']).optional(),
  mentoring: z.boolean().optional(),
});

export const LlmProviderSchema = z.enum(['github-copilot', 'openai-compatible']);
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export const LlmGenerationParamsSchema = z.object({
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().min(0).max(1).optional(),
  presencePenalty: z.number().min(-2).max(2).optional(),
  frequencyPenalty: z.number().min(-2).max(2).optional(),
  stop: z.array(z.string()).max(8).optional(),
});

export const ProviderModelSchema = z.object({
  name: z.string().min(1),
  contextWindow: z.number().int().positive().optional(),
  maxPromptTokens: z.number().int().positive().optional(),
  maxContextWindowTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
});

export type ProviderModel = z.infer<typeof ProviderModelSchema>;

export const LlmProfileSchema = z.object({
  provider: z.string().min(1).optional(),
  modelKey: z.string().min(1).optional(),
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  params: LlmGenerationParamsSchema.optional(),
});

export const LlmProviderConfigSchema = z.object({
  kind: LlmProviderSchema,
  defaultModel: z.string().min(1).optional(),
  models: z.array(ProviderModelSchema).optional(),
  imageModels: z.record(z.string(), z.string()).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnvVar: z.string().min(1).optional(),
  params: LlmGenerationParamsSchema.optional(),
  contextWindow: z.number().int().positive().optional(),
});

export const ProviderConfigSchema = z.object({
  kind: LlmProviderSchema,
  defaultModel: z.string().min(1).optional(),
  models: z.array(ProviderModelSchema).optional(),
  imageModels: z.record(z.string(), z.string()).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnvVar: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  params: LlmGenerationParamsSchema.optional(),
  modelDiscovery: z
    .object({
      lastRefreshedAt: z.string().optional(),
      lastRefreshStatus: z.enum(['ok', 'error']).optional(),
      lastRefreshError: z.string().optional(),
    })
    .optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const ModelKeyEntrySchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  contextWindow: z.number().int().positive().optional(),
  params: LlmGenerationParamsSchema.optional(),
});

export type ModelKeyEntry = z.infer<typeof ModelKeyEntrySchema>;

export const UserProfileSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  email: z.string().optional(),
  avatar: z.string().optional(),
  portfolioUrl: z.string().optional(),
});

export type UserProfile = z.infer<typeof UserProfileSchema>;

export const AgentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
});

export const AgentSkillFileSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  triggers: z.array(z.string()).optional(),
});

export const AgentCapabilitiesSchema = z.object({
  streaming: z.boolean().optional(),
  multimodal: z.boolean().optional(),
  codeExecution: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});

export const AgentHandoffSchema = z.object({
  label: z.string(),
  agent: z.string(),
  prompt: z.string().optional(),
  send: z.boolean().optional(),
  model: z.string().optional(),
});

export const AgentSchema = z
  .object({
    aiTeamName: z.string().optional(),
    aiTeamId: z.string().optional(),
    name: z.string().optional(),
    id: z.string().optional(),
    role: z.string(),
    type: z.nativeEnum(RoleType).optional(),
    contextLevel: z.nativeEnum(ContextLevel),
    reportsTo: z.string().optional(),
    features: z.array(z.string()).optional(),
    specializations: z.array(z.string()).optional(),
    avatar: AvatarConfigSchema.optional(),
    personality: PersonalityConfigSchema.optional(),
    pronouns: z.string().optional(),
    ttsVoice: z.string().optional(),
    ttsRate: z.number().min(0.1).max(10).optional(),
    workHours: z.string().optional(),
    description: z.string().optional(),
    version: z.string().optional(),
    goal: z.string().optional(),
    backstory: z.string().optional(),
    capabilities: AgentCapabilitiesSchema.optional(),
    skills: z.array(AgentSkillSchema).optional(),
    applyTo: z.string().optional(),
    paths: z.array(z.string()).optional(),
    memory: z.boolean().optional(),
    maxIterations: z.number().optional(),
    tools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).optional(),
    cliTools: z.array(z.string()).optional(),
    canDelegate: z.boolean().optional(),
    delegatesTo: z.array(z.string()).optional(),
    availableFor: z.array(z.string()).optional(),
    llm: LlmProfileSchema.optional(),
    'argument-hint': z.string().optional(),
    agents: z.array(z.string()).optional(),
    model: z.union([z.string(), z.array(z.string())]).optional(),
    'user-invocable': z.boolean().optional(),
    'disable-model-invocation': z.boolean().optional(),
    target: z.enum(['vscode', 'github-copilot']).optional(),
    'mcp-servers': z.record(z.string(), z.unknown()).optional(),
    handoffs: z.array(AgentHandoffSchema).optional(),
    hooks: z.record(z.string(), z.unknown()).optional(),
    readTheseFilesFirst: z.array(z.string()).optional(),
  })
  .passthrough();

export const SkillSchema = z.object({
  name: z.string(),
  type: z.nativeEnum(RoleType).optional(),
  description: z.string(),
  contextLevel: z.nativeEnum(ContextLevel).optional(),
  responsibilities: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  canDelegate: z.boolean().optional(),
  llm: LlmProfileSchema.optional(),
  triggers: z.array(z.string()).optional(),
});

export const FeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  owner: z.string(),
  team: z.array(z.string()),
  contextPaths: z.array(z.string()),
  status: z.enum(['planning', 'active', 'maintenance', 'archived']),
});

export const LlmConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  params: LlmGenerationParamsSchema.optional(),
});

export type LlmConfig = z.infer<typeof LlmConfigSchema>;

export const FileTreeConfigSchema = z.object({
  readPaths: z.array(z.string()).optional().default([]),
  writePaths: z.array(z.string()).optional().default([]),
});

export type FileTreeConfig = z.infer<typeof FileTreeConfigSchema>;

export const FileTypeGroupConfigSchema = z.object({
  label: z.string().min(1).optional(),
  patterns: z.array(z.string().min(1)).optional().default([]),
  extensions: z.array(z.string().min(1)).optional(),
});

export type FileTypeGroupConfig = z.infer<typeof FileTypeGroupConfigSchema>;

export const TeamConfigSchema = z.object({
  version: z.string(),
  llm: LlmConfigSchema.optional(),
  providers: z.record(z.string(), LlmProviderConfigSchema).optional(),
  defaultModel: z
    .object({
      provider: z.string().min(1),
      model: z.string().min(1),
      contextWindow: z.number().int().positive().optional(),
    })
    .optional(),
  skillSources: z.array(z.string().url()).optional(),
  allowedCliTools: z.array(z.string().min(1)).optional(),
  avatarStyle: z.enum(['professional-headshot', 'avatar', 'illustrated']).optional(),
  randomAvatarUrls: z.array(z.string().url()).optional().default([]),
  fileTree: FileTreeConfigSchema.optional(),
  fileTypeGroups: z.record(z.string().min(1), FileTypeGroupConfigSchema).optional(),
  projectName: z.string().min(1).optional(),
  modelKeys: z.record(z.string(), ModelKeyEntrySchema).optional(),
  systemModels: z
    .record(
      z.string(),
      z.object({
        provider: z.string().min(1).optional(),
        modelKey: z.string().min(1).optional(),
        model: z.string().min(1).optional(),
        contextWindow: z.number().int().positive().optional(),
      })
    )
    .optional(),
});

export type TeamConfig = z.infer<typeof TeamConfigSchema>;

export const UserConfigSchema = TeamConfigSchema.extend({
  version: z.string().optional(),
  developer: UserProfileSchema.optional(),
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
  randomAvatarUrls: z.array(z.string().url()).optional(),
}).partial();

export type UserConfig = z.infer<typeof UserConfigSchema>;

export const SYSTEM_MODEL_KEYS = {
  summarize: 'summarize',
  title: 'title',
} as const;

export type SystemModelKey = keyof typeof SYSTEM_MODEL_KEYS;

export type AvatarConfig = z.infer<typeof AvatarConfigSchema>;
export type PersonalityConfig = z.infer<typeof PersonalityConfigSchema>;
export type LlmGenerationParams = z.infer<typeof LlmGenerationParamsSchema>;
export type LlmProfile = z.infer<typeof LlmProfileSchema>;
export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;
export type AgentConfig = z.infer<typeof AgentSchema>;
export type SkillConfig = z.infer<typeof SkillSchema>;
export type FeatureConfig = z.infer<typeof FeatureSchema>;
export type AgentSkillFileConfig = z.infer<typeof AgentSkillFileSchema>;
