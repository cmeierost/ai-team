import { AgentStatus, ContextLevel, RoleType } from './taxonomy.js';
import type { AgentConfig, FeatureConfig, SkillConfig } from './schemas.js';
import type {
  AnalyzePermissionOverlapOptions,
  PermissionOverlapReport,
} from '../context/perm-overlap.js';

export interface PermissionConfig {
  list?: string[];
  read: string[];
  write: string[];
  approve?: boolean;
  manage_agents?: boolean;
}

export interface Agent extends AgentConfig {
  id: string;
  name: string;
  filePath: string;
  skillPath: string;
  markdown?: string;
  createdAt: string;
  lastInteraction?: string;
  conversationCount?: number;
  status?: AgentStatus;
  permissions?: PermissionConfig;
  resolvedLlm?: {
    providerRef?: string;
    model?: string;
    contextWindow?: number;
    isDefault: boolean;
  };
}

export interface Skill extends SkillConfig {
  filePath: string;
  instructions: string;
}

export interface AgentSkillFile {
  filePath: string;
  name: string;
  description?: string;
  triggers?: string[];
  instructions: string;
}

export interface InstructionFile {
  filePath: string;
  applyTo: string;
  instructions: string;
}

export interface Feature extends FeatureConfig {}

export interface AgentSearchOptions {
  query?: string;
  role?: string | string[];
  type?: RoleType | RoleType[];
  status?: AgentStatus | AgentStatus[];
  feature?: string | string[];
  specialization?: string | string[];
  tool?: string | string[];
  reportsTo?: string;
  contextLevel?: ContextLevel | ContextLevel[];
}

export interface AgentSearchResult {
  agent: Agent;
  score: number;
  matches: string[];
}

export interface IAgentManager {
  getAgentsAsync(): Promise<Map<string, Agent>>;
  refreshAsync(): Promise<void>;
  getAllAgentsAsync(): Promise<Agent[]>;
  getAgentAsync(id: string): Promise<Agent | undefined>;
  getAgentOrThrowAsync(id: string): Promise<Agent>;
  resolveAgentAsync(query: string): Promise<Agent[]>;
  resolveAgentOrThrowAsync(query: string): Promise<Agent>;
  resolveAgentForOperationAsync(
    query: string,
    operation: string
  ): Promise<{ id: string; name: string; role: string }>;
  resolveAgentSafeAsync(query: string): Promise<{ id: string; name: string; role: string } | null>;
  analyzeWorkspacePermissionOverlap(
    options?: AnalyzePermissionOverlapOptions
  ): Promise<PermissionOverlapReport>;
  createAgentAsync(
    config: AgentConfig,
    options?: { markdown?: string; targetPath?: string } | string
  ): Promise<Agent>;
  updateAgentAsync(
    id: string,
    updates: Partial<AgentConfig> & { markdown?: string }
  ): Promise<Agent>;
  recordInteractionAsync(id: string): Promise<void>;
  archiveAgentAsync(id: string): Promise<void>;
  getAgentsByRoleAsync(role: string): Promise<Agent[]>;
  getDirectReportsAsync(managerId: string): Promise<Agent[]>;
  searchAgentsAsync(options: AgentSearchOptions): Promise<AgentSearchResult[]>;
}

export interface RankedAgentResult {
  agent: Agent;
  score: number;
  exactMatch?: boolean;
  matches: string[];
}

export interface IAgentSearchService {
  rankAgents(query: string | undefined, agents: Agent[]): RankedAgentResult[];
  rankAgentsByIdentity(query: string | undefined, agents: Agent[]): RankedAgentResult[];
  filterAndRankAgents(options: AgentSearchOptions, agents: Agent[]): AgentSearchResult[];
}

export interface AgentStats {
  conversationCount: number;
  meetingSummaryCount: number;
  codeReviewCount: number;
  taskCompletionRate: number;
  avgResponseTime: number;
  utilizationRate: number;
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
