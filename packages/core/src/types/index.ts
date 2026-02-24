/**
 * Core type definitions for AI Team system
 * These types define the domain model for virtual AI team members and their organization
 */

import { z } from 'zod';

// ============================================================================
// Enums and Constants
// ============================================================================

export enum RoleType {
  EXECUTIVE = 'executive',
  LEADERSHIP = 'leadership',
  TEAM_LEAD = 'team-lead',
  INDIVIDUAL_CONTRIBUTOR = 'individual-contributor',
  QUALITY_GATE = 'quality-gate',
  CROSS_CONCERN = 'cross-concern',
  PRODUCT = 'product',
}

export enum ContextLevel {
  TASK = 'task',               // Junior dev - only assigned files
  MODULE = 'module',           // Senior dev - specific modules
  FEATURE = 'feature',         // Team lead - feature area
  REPOSITORY = 'repository',   // Architect - entire codebase (read)
  ORGANIZATION = 'organization', // Executive - strategic docs only
}

export enum AgentStatus {
  AVAILABLE = 'available',
  BUSY = 'busy',
  IN_MEETING = 'in-meeting',
  OFFLINE = 'offline',
}

export enum EdgeType {
  REPORTS_TO = 'reports-to',
  MANAGES = 'manages',
  OWNS_FEATURE = 'owns-feature',
  CONTRIBUTES_TO = 'contributes-to',
  CONSULTS_ON = 'consults-on',
  SHARES_CONTEXT = 'shares-context',
}

// ============================================================================
// Zod Schemas (for validation)
// ============================================================================

export const AvatarConfigSchema = z.object({
  type: z.enum(['ai-generated', 'url', 'initials']),
  seed: z.string().optional(),
  url: z.string().url().optional(),
  style: z.enum(['professional-headshot', 'avatar', 'illustrated']).optional(),
});

export const PersonalityConfigSchema = z.object({
  communication_style: z.enum(['collaborative', 'direct', 'supportive', 'analytical', 'strategic']).optional(),
  expertise_level: z.enum(['executive', 'senior', 'mid-level', 'junior']).optional(),
  mentoring: z.boolean().optional(),
});

export const PermissionConfigSchema = z.object({
  read: z.array(z.string()),
  write: z.array(z.string()),
  approve: z.boolean().optional(),
  manage_agents: z.boolean().optional(),
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

export const LlmProfileSchema = z.object({
  provider: z.string().min(1).optional(),
  modelKey: z.string().min(1).optional(),
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  params: LlmGenerationParamsSchema.optional(),
});

export const LlmProviderConfigSchema = z.object({
  kind: LlmProviderSchema,
  isDefault: z.boolean().optional(),
  model: z.string().optional(),
  defaultModelKey: z.string().min(1).optional(),
  models: z.record(z.string(), z.string()).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnvVar: z.string().min(1).optional(),
  params: LlmGenerationParamsSchema.optional(),
});

export const AgentSchema = z.object({
  name: z.string(),
  role: z.string(),
  type: z.nativeEnum(RoleType).optional(),
  contextLevel: z.nativeEnum(ContextLevel),
  
  // Organization
 reportsTo: z.string().optional(),
  features: z.array(z.string()).optional(),
  specializations: z.array(z.string()).optional(),
  
  // Identity
  avatar: AvatarConfigSchema.optional(),
  personality: PersonalityConfigSchema.optional(),
  pronouns: z.string().optional(),
  timezone: z.string().optional(),
  workHours: z.string().optional(),
  
  // Permissions
  permissions: PermissionConfigSchema.optional(),
  
  // Capabilities
  tools: z.array(z.string()).optional(),
  cliTools: z.array(z.string()).optional(),
  canDelegate: z.boolean().optional(),
  delegatesTo: z.array(z.string()).optional(),
  availableFor: z.array(z.string()).optional(),
  llm: LlmProfileSchema.optional(),
});

export const SkillSchema = z.object({
  name: z.string(),
  type: z.nativeEnum(RoleType),
  description: z.string(),
  contextLevel: z.nativeEnum(ContextLevel),
  
  responsibilities: z.array(z.string()),
  tools: z.array(z.string()),
  permissions: PermissionConfigSchema,
  
  canDelegate: z.boolean().optional(),
  llm: LlmProfileSchema.optional(),
});

export const FeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  owner: z.string(),  // Agent ID
  team: z.array(z.string()),  // Agent IDs
  contextPaths: z.array(z.string()),
  status: z.enum(['planning', 'active', 'maintenance', 'archived']),
});

// ============================================================================
// TypeScript Interfaces (inferred from schemas)
// ============================================================================

export type AvatarConfig = z.infer<typeof AvatarConfigSchema>;
export type PersonalityConfig = z.infer<typeof PersonalityConfigSchema>;
export type PermissionConfig = z.infer<typeof PermissionConfigSchema>;
export type LlmGenerationParams = z.infer<typeof LlmGenerationParamsSchema>;
export type LlmProfile = z.infer<typeof LlmProfileSchema>;
export type LlmProviderConfig = z.infer<typeof LlmProviderConfigSchema>;
export type AgentConfig = z.infer<typeof AgentSchema>;
export type SkillConfig = z.infer<typeof SkillSchema>;
export type FeatureConfig = z.infer<typeof FeatureSchema>;

/**
 * Agent represents a virtual AI team member
 */
export interface Agent extends AgentConfig {
  id: string;
  filePath: string;
  skillPath: string;
  markdown?: string;  // Portfolio/bio content
  createdAt: string;
  lastInteraction?: string;
  conversationCount?: number;
  status?: AgentStatus;
}

/**
 * Skill represents a role template
 */
export interface Skill extends SkillConfig {
  filePath: string;
  instructions: string;  // Markdown content
}

/**
 * Feature represents a product feature with assigned team
 */
export interface Feature extends FeatureConfig {}

// ============================================================================
// Graph Data Structures
// ============================================================================

export interface GraphNode {
  id: string;
  type: 'agent' | 'feature';
  data: {
    label: string;
    agent?: Agent;
    feature?: Feature;
    role?: string;
    status?: AgentStatus;
  };
  position?: { x: number; y: number };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type ViewMode = 'hierarchy' | 'features' | 'expertise' | 'matrix';

// ============================================================================
// Context & Permissions
// ============================================================================

export interface ContextItem {
  type: 'file' | 'selection' | 'note' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export interface ContextShare {
  from: string;  // Agent ID
  to: string;    // Agent ID
  items: string[];  // File patterns or specific items
  timestamp: string;
  reason?: string;
}

export interface FileContext {
  files: string[];  // File patterns
  detail: 'summary' | 'overview' | 'detailed' | 'full';
}

// ============================================================================
// Chat & Messaging
// ============================================================================

export interface ChatMessage {
  timestamp: string;
  from: 'human' | string;  // 'human' or agent ID
  content: string;
  context?: string[];  // File paths referenced
  tool_calls?: ToolCall[];
  suggestions?: CodeSuggestion[];
}

export interface ToolCall {
  tool: string;
  params: Record<string, unknown>;
  result?: unknown;
}

export interface CodeSuggestion {
  type: 'code_improvement' | 'refactor' | 'fix' | 'security';
  file: string;
  line?: number;
  description: string;
  code?: string;
}

export interface MeetingSummary {
  date: string;
  participants: string[];  // Agent IDs or 'human'
  type: 'code-review' | 'design-discussion' | 'planning' | 'bug-investigation' | 'org-change';
  title: string;
  duration?: string;
  summary: string;
  keyPoints?: string[];
  decisions?: Decision[];
  actionItems?: ActionItem[];
  relatedFiles?: string[];
  chatSession?: string;  // Path to JSONL
}

export interface Decision {
  type: string;
  description: string;
  rationale?: string;
}

export interface ActionItem {
  assignee: string;
  task: string;
  completed?: boolean;
}

// ============================================================================
// Tool System
// ============================================================================

export interface ToolContext {
  agent: Agent;
  workspaceRoot: string;
  currentFiles?: string[];
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute(params: unknown, context: ToolContext): Promise<unknown>;
}

// ============================================================================
// HR & Team Management
// ============================================================================

export interface AgentStats {
  conversationCount: number;
  meetingSummaryCount: number;
  codeReviewCount: number;
  taskCompletionRate: number;
  avgResponseTime: number;  // minutes
  utilizationRate: number;  // percentage
}

export interface PerformanceReport {
  agent: string;
  role: string;
  stats: AgentStats;
  assessment: 'excellent' | 'good' | 'adequate' | 'needs-improvement' | 'underutilized';
  recommendations: string[];
}

export interface TeamHealthSummary {
  period: string;
  teamSize: number;
  avgUtilization: number;
  totalConversations: number;
  totalMeetings: number;
  topPerformers: string[];
  underutilized: string[];
  recommendations: string[];
}

export const LlmConfigSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  /** Base URL for OpenAI-compatible endpoints (not used for GitHub Copilot) */
  baseUrl: z.string().url().optional(),
  params: LlmGenerationParamsSchema.optional(),
});

export type LlmConfig = z.infer<typeof LlmConfigSchema>;

// ============================================================================
// Configuration
// ============================================================================

export const TeamConfigSchema = z.object({
  version: z.string(),
  llm: LlmConfigSchema.optional(),
  providers: z.record(z.string(), LlmProviderConfigSchema).optional(),
  llmProviders: z.record(z.string(), LlmProviderConfigSchema).optional(),
  defaultLlmProvider: z.string().min(1).optional(),
  allowedCliTools: z.array(z.string().min(1)).optional(),
  avatarStyle: z.enum(['professional-headshot', 'avatar', 'illustrated']).optional(),
});

export type TeamConfig = z.infer<typeof TeamConfigSchema>;

// ============================================================================
// Errors
// ============================================================================

export class PermissionError extends Error {
  constructor(agentId: string, filePath: string) {
    super(`Agent ${agentId} does not have permission to access ${filePath}`);
    this.name = 'PermissionError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class FileNotFoundError extends Error {
  constructor(filePath: string) {
    super(`File not found: ${filePath}`);
    this.name = 'FileNotFoundError';
  }
}

export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = 'AgentNotFoundError';
  }
}
