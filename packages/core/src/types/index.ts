/**
 * Core type definitions for AI Team system
 * These types define the domain model for virtual AI team members and their organization
 */

import { z } from 'zod';

// Structured tool result shapes (pure data — no orchestrator dependency)
export * from './tool-results.js';

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
  REPORTS_TO_UNRESOLVED = 'reports-to-unresolved',
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
  url: z.string().optional(),
  style: z.enum(['professional-headshot', 'avatar', 'illustrated']).optional(),
  color: z.string().optional(),
});

export const PersonalityConfigSchema = z.object({
  communication_style: z.enum(['collaborative', 'direct', 'supportive', 'analytical', 'strategic']).optional(),
  expertise_level: z.enum(['executive', 'senior', 'mid-level', 'junior']).optional(),
  mentoring: z.boolean().optional(),
});

export const PermissionConfigSchema = z.object({
  read: z.array(z.string()),
  write: z.array(z.string()),
  create: z.array(z.string()).optional().default([]),
  delete: z.array(z.string()).optional().default([]),
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
  imageModels: z.record(z.string(), z.string()).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyEnvVar: z.string().min(1).optional(),
  params: LlmGenerationParamsSchema.optional(),
});

// A2A AgentCard-aligned skill definition
export const AgentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
});

// A2A AgentCard-aligned capabilities
export const AgentCapabilitiesSchema = z.object({
  streaming: z.boolean().optional(),
  multimodal: z.boolean().optional(),
  codeExecution: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});

export const AgentSchema = z.object({
  // Vendor-neutral ai-team aliases (authoritative when provided)
  aiTeamName: z.string().optional(),
  aiTeamId: z.string().optional(),

  // Generic fields used across other ecosystems
  name: z.string().optional(),
  id: z.string().optional(),
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
  
  // Discovery (A2A AgentCard aligned)
  description: z.string().optional(),
  version: z.string().optional(),

  // Persona (CrewAI aligned)
  goal: z.string().optional(),
  backstory: z.string().optional(),

  // Agent capabilities (A2A aligned)
  capabilities: AgentCapabilitiesSchema.optional(),

  // Structured skill definitions (A2A AgentCard aligned)
  skills: z.array(AgentSkillSchema).optional(),

  // Path scoping — Copilot & Claude Code compatibility
  applyTo: z.string().optional(),
  paths: z.array(z.string()).optional(),

  // Operational (CrewAI / OpenAI Agents aligned)
  memory: z.boolean().optional(),
  maxIterations: z.number().optional(),

  // Permissions
  permissions: PermissionConfigSchema.optional(),
  
  // Capabilities — tools & delegation
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
  name: string;
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
// Agent Search
// ============================================================================

/**
 * Options for searching agents
 */
export interface AgentSearchOptions {
  query?: string;  // Fulltext search term (fuzzy)
  role?: string | string[];  // Filter by role(s)
  type?: RoleType | RoleType[];  // Filter by type
  status?: AgentStatus | AgentStatus[];  // Filter by status
  feature?: string | string[];  // Filter by features
  specialization?: string | string[];  // Filter by specializations
  tool?: string | string[];  // Filter by tools
  reportsTo?: string;  // Filter by manager
  contextLevel?: ContextLevel | ContextLevel[];  // Filter by context level
}

/**
 * Result from agent search with scoring
 */
export interface AgentSearchResult {
  agent: Agent;
  score: number;  // Relevance score (higher is better)
  matches: string[];  // Fields that matched (for highlighting)
}

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
  error?: string;
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
  from: string;  // Agent ID or developer ID (e.g., 'clemens-meier')
  to?: string;  // Target agent ID (used for handoff messages)
  isHuman?: boolean;  // True if message is from human developer
  content: string;
  context?: string[];  // File paths referenced
  tool_calls?: ToolCall[];
  suggestions?: CodeSuggestion[];
  archived?: boolean;  // If true, message is shown but not sent to LLM
  handoffType?: 'user-acknowledgment' | 'agent-briefing';  // Type of handoff message
  targetAgentId?: string;  // Target agent for briefing messages
  handoffFromSessionId?: string;  // Session ID this briefing was forwarded FROM
  handoffToSessionId?: string;    // Session ID this briefing was forwarded TO
  handoffId?: string;             // UUID shared by all messages belonging to one handoff event
  importance?: 'low' | 'normal' | 'high'; // Message priority for LLM context/RAG filtering; undefined = normal
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

// ============================================================================
// Sessions & Artifacts
// ============================================================================

/**
 * RAG (Retrieval-Augmented Generation) configuration for a session
 * Controls how context is retrieved and prioritized for this workspace
 */
export interface SessionRagConfig {
  /** Maximum number of file chunks to include in context */
  maxChunks?: number;
  /** Similarity threshold for semantic search (0-1) */
  similarityThreshold?: number;
  /** Whether to include git history in context */
  includeGitHistory?: boolean;
  /** Custom embedding model override */
  embeddingModel?: string;
}

/**
 * Chat session - represents a conversation workspace with an agent or multiple agents
 * Sessions are the primary unit for chat interactions and include workspace features
 * like prioritized files, tasks, artifacts, and RAG configuration
 */
export interface ChatSession {
  id: string;  // e.g., 'session-2026-02-27-abc123'
  
  // Agent(s) involved in this session
  agentIds: string[];  // Primary field - supports multi-agent sessions
  agentId: string;  // Deprecated: kept for backward compatibility, returns agentIds[0]
  
  developerId: string;  // e.g., 'clemens-meier'
  startedAt: string;  // ISO timestamp
  lastActivityAt: string;  // ISO timestamp
  messageCount: number;
  
  // Session workspace features
  title?: string;  // Auto-generated after 2nd human message
  artifacts: string[];  // Artifact IDs or paths in context
  allowedFiles: string[];  // Files agent can access in this session
  prioritizedFiles?: string[];  // Files ranked for RAG retrieval priority
  tasks?: string[];  // Linked task IDs for session goals
  notes?: string;  // Session-level notes/brief for developer
  ragConfig?: SessionRagConfig;  // Per-session context strategy
  
  // Session relationships
  previousSessionId?: string;  // ID of session this was handed off from
  mergedFromSessionIds?: string[];  // Sessions that were merged into this one
}

export interface Artifact {
  id: string;  // e.g., 'brief-user-auth-design'
  type: 'brief' | 'summary' | 'record' | 'document';
  title: string;
  content: string;  // Markdown content
  createdAt: string;
  createdBy: string;  // developer ID
  sourceSessionId: string;  // Session where it was created
  fromMessageIndex: number;  // Start of summarized range
  toMessageIndex: number;  // End of summarized range
  filepath: string;  // .ai-team/artifacts/briefs/{filename}.md
  tags?: string[];
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
// Task Management
// ============================================================================

export enum TaskStatus {
  NOT_STARTED = "not_started",
  IN_PROGRESS = "in_progress",
  BLOCKED = "blocked",
  WAITING_APPROVAL = "waiting_approval",
  COMPLETED = "completed",
  CANCELLED = "cancelled",
  DELEGATED = "delegated",
}

export enum TaskPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  URGENT = "urgent",
}

export enum TaskType {
  FEATURE = "feature",
  BUG = "bug",
  DOCUMENTATION = "documentation",
}

export enum TaskExecutionMode {
  SEQUENTIAL = "sequential",
  PARALLEL = "parallel",
}

export interface TimeLogEntry {
  id: string;
  taskId: string;
  agentId: string;
  startTime: Date;
  endTime?: Date;
  durationMinutes?: number;
  description?: string;
  createdAt: Date;
}

export interface WorkflowStep {
  id: string;
  title: string;
  description?: string;
  assignedTo?: string;
  autoAssign: boolean;
  accepted?: boolean;
  status: TaskStatus;
  dependencies?: string[];
  order: number;
  completedAt?: Date;
}

export interface TaskDelegationRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  delegatedAt: Date;
  reason?: string;
  accepted: boolean;
  acceptedAt?: Date;
}

export interface Task {
  id: string;
  type: TaskType;
  title: string;
  description?: string;
  createdBy: string;
  createdByType: "human" | "agent";
  assignedTo?: string;
  status: TaskStatus;
  priority: TaskPriority;
  requiresApproval: boolean;
  approved?: boolean;
  approvedBy?: string;
  approvedAt?: Date;
  parentTaskId?: string;
  subtaskIds?: string[];
  executionMode?: TaskExecutionMode;
  workflowSteps?: WorkflowStep[];
  estimatedHours?: number;
  actualHours?: number;
  timeLog?: TimeLogEntry[];
  dueDate?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  tags?: string[];
  sessionId?: string;
  artifactIds?: string[];
  delegationHistory?: TaskDelegationRecord[];
  delegatedTo?: string;
  blockedReason?: string;
  blockedBy?: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskTemplate {
  id: string;
  name: string;
  type: TaskType;
  description: string;
  titleTemplate: string;
  descriptionTemplate: string;
  priority: TaskPriority;
  estimatedHours?: number;
  workflowSteps?: Omit<WorkflowStep, "id" | "status" | "completedAt">[];
  tags?: string[];
  requiresApproval: boolean;
}

export interface TaskStatistics {
  totalTasks: number;
  tasksByStatus: Record<TaskStatus, number>;
  tasksByPriority: Record<TaskPriority, number>;
  tasksByAgent: Record<string, number>;
  averageCompletionTime?: number;
  totalEstimatedHours: number;
  totalActualHours: number;
}

// ============================================================================
// Tool System
// ============================================================================

export interface ToolContext {
  agent: Agent;
  workspaceRoot: string;
  currentFiles?: string[];
}

/**
 * Declarative permission descriptor attached to each tool.
 * ToolManager reads this to call ContextManager once in canExecute()
 * rather than having each tool do its own permission check internally.
 */
export type PermissionDescriptor =
  | { type: 'none' }
  | { type: 'file-read';        argsPath: string }
  | { type: 'file-write';       argsPath: string }
  | { type: 'agent-delegation'; argsPath: string }
  | { type: 'manage-agents' };

/** Result of a ToolManager.canExecute() check. */
export interface PermissionResult {
  allowed: boolean;
  reason?: string;
}

export interface AgentTool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  /**
   * Declarative permission requirements for this tool.
   * When omitted the ToolManager falls back to { type: 'none' }.
   */
  permissionCheck?: PermissionDescriptor;
  /** Optional usage examples shown in catalog() output. */
  examples?: string[];
  /** Optional tags for filtering and documentation. */
  tags?: string[];
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

export const FileTreeConfigSchema = z.object({
  /**
   * Global workspace-wide read permission patterns.
   * Any agent inherits these patterns in addition to its own.
   */
  readPaths: z.array(z.string()).optional().default([]),
  /**
   * Global workspace-wide write permission patterns.
   * Any agent inherits these patterns in addition to its own.
   */
  writePaths: z.array(z.string()).optional().default([]),
  /**
   * Global workspace-wide create permission patterns (typically directory-scoped).
   */
  createPaths: z.array(z.string()).optional().default([]),
  /**
   * Global workspace-wide delete permission patterns.
   */
  deletePaths: z.array(z.string()).optional().default([]),
});

export type FileTreeConfig = z.infer<typeof FileTreeConfigSchema>;

export const TeamConfigSchema = z.object({
  version: z.string(),
  llm: LlmConfigSchema.optional(),
  providers: z.record(z.string(), LlmProviderConfigSchema).optional(),
  llmProviders: z.record(z.string(), LlmProviderConfigSchema).optional(),
  defaultLlmProvider: z.string().min(1).optional(),
  allowedCliTools: z.array(z.string().min(1)).optional(),
  avatarStyle: z.enum(['professional-headshot', 'avatar', 'illustrated']).optional(),
  randomAvatarUrls: z.array(z.string().url()).optional().default([]),
  /** File tree behaviour for the agent portfolio permission editor */
  fileTree: FileTreeConfigSchema.optional(),
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

// Context management types
export interface MessageAnnotation {
  type: 'summary' | 'anti-pattern' | 'highlight' | 'note';
  content: string;
  timestamp: string;
  tags?: string[];
}

export interface AnnotatedChatMessage extends ChatMessage {
  annotations?: MessageAnnotation[];
}

export interface ChatSummary {
  id: string;
  title: string;
  content: string;
  sourceMessages: {
    agentId: string;
    messageIndices: number[];
  };
  timestamp: string;
  tags?: string[];
}

export interface ArtifactReference {
  type: 'summary' | 'document' | 'code-snippet';
  path: string;
  title: string;
  tags?: string[];
}

export interface MessageStats {
  total: number;
  archived: number;
  active: number;
  byAgent: Record<string, number>;
}
