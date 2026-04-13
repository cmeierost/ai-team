import type { ApiDescription } from '@ts-http/core';
import type { LlmProfile } from './config.js';
import type { ChatCommandRegistryEntry } from './commands.js';

// ─── Domain enums / primitives ───────────────────────────────────────────────

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
  TASK = 'task',
  MODULE = 'module',
  FEATURE = 'feature',
  REPOSITORY = 'repository',
  ORGANIZATION = 'organization',
}

export enum AgentStatus {
  AVAILABLE = 'available',
  BUSY = 'busy',
  IN_MEETING = 'in-meeting',
  OFFLINE = 'offline',
}

// ─── Agent DTOs ───────────────────────────────────────────────────────────────

export interface AvatarConfig {
  type: 'ai-generated' | 'url' | 'initials';
  seed?: string;
  url?: string;
  style?: 'professional-headshot' | 'avatar' | 'illustrated';
  color?: string;
}

export interface PersonalityConfig {
  communication_style?: 'collaborative' | 'direct' | 'supportive' | 'analytical' | 'strategic';
  expertise_level?: 'executive' | 'senior' | 'mid-level' | 'junior';
  mentoring?: boolean;
}

export interface AgentHandoff {
  label: string;
  agent: string;
  prompt?: string;
  send?: boolean;
  model?: string;
}

export interface AgentConfig {
  aiTeamName?: string;
  aiTeamId?: string;
  name?: string;
  id?: string;
  role: string;
  type?: RoleType;
  contextLevel: ContextLevel;
  reportsTo?: string;
  features?: string[];
  specializations?: string[];
  avatar?: AvatarConfig;
  personality?: PersonalityConfig;
  pronouns?: string;
  workHours?: string;
  description?: string;
  version?: string;
  goal?: string;
  backstory?: string;
  skills?: Array<{
    id: string;
    name: string;
    description?: string;
    tags?: string[];
    examples?: string[];
  }>;
  applyTo?: string;
  paths?: string[];
  memory?: boolean;
  maxIterations?: number;
  tools?: string[];
  disallowedTools?: string[];
  cliTools?: string[];
  canDelegate?: boolean;
  delegatesTo?: string[];
  availableFor?: string[];
  llm?: LlmProfile;
  agents?: string[];
  model?: string | string[];
  handoffs?: AgentHandoff[];
  readTheseFilesFirst?: string[];
  [key: string]: unknown;
}

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

/** Alias for Agent — used in employee-facing API responses. */
export type Employee = Agent;

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

export interface SearchAgentsResponse {
  results: AgentSearchResult[];
  totalCount: number;
}

export interface ListEmployeesRequest {
  role?: string;
  feature?: string;
}

// ─── File / content DTOs ─────────────────────────────────────────────────────

export interface AnnotatedFile {
  path: string;
  readable: boolean;
  listable: boolean;
  writable: boolean;
}

export interface MarkdownSection {
  heading: string;
  content: string;
}

/** Response shape for agent file-tree listing with read/list/write annotations */
export interface AgentFilesResponse {
  agent: string;
  readPatterns: string[];
  writePatterns: string[];
  createPatterns?: string[];
  deletePatterns?: string[];
  files: AnnotatedFile[];
}

export interface IAgentsService {
  list(): Promise<Agent[]>;
  search(query?: {
    q?: string;
    role?: string | string[];
    type?: string | string[];
    status?: string | string[];
    feature?: string | string[];
    specialization?: string | string[];
    tool?: string | string[];
    reportsTo?: string;
    contextLevel?: string | string[];
  }): Promise<SearchAgentsResponse>;
  resolve(id: string): Promise<Agent>;
  getFrontmatter(id: string): Promise<AgentConfig>;
  updateFrontmatter(id: string, body: Record<string, unknown>): Promise<Agent>;
  uploadAvatar(id: string, body: { data: string; ext: string }): Promise<Agent>;
  getSections(id: string): Promise<MarkdownSection[]>;
  updateSection(id: string, heading: string, body: { content: string }): Promise<Agent>;
  getMarkdown(id: string): Promise<{ markdown: string }>;
  updateMarkdown(id: string, body: { markdown: string }): Promise<Agent>;
  getFiles(id: string): Promise<{ files: AnnotatedFile[] }>;
  generateHandoffPrompt(
    id: string,
    body: { targetAgentId: string; context?: string }
  ): Promise<{ prompt: string }>;
  getSlashCommands(id: string): Promise<ChatCommandRegistryEntry[]>;
  introduction(
    id: string,
    query?: { developerName?: string }
  ): Promise<{ agentId: string; content: string; timestamp: string }>;
}

export const agentsDesc: ApiDescription<IAgentsService> = {
  subRoute: '/api/agents',
  mapping: {
    list: { method: 'GET', path: '' },
    search: { method: 'GET', path: 'search' },
    resolve: { method: 'GET', path: ':id' },
    getFrontmatter: { method: 'GET', path: ':id/frontmatter' },
    updateFrontmatter: { method: 'PUT', path: ':id/frontmatter' },
    uploadAvatar: { method: 'POST', path: ':id/avatar' },
    getSections: { method: 'GET', path: ':id/sections' },
    updateSection: { method: 'PUT', path: ':id/sections/:heading' },
    getMarkdown: { method: 'GET', path: ':id/markdown' },
    updateMarkdown: { method: 'PUT', path: ':id/markdown' },
    getFiles: { method: 'GET', path: ':id/files' },
    generateHandoffPrompt: { method: 'POST', path: ':id/handoff-prompt' },
    getSlashCommands: { method: 'GET', path: ':id/slash-commands' },
    introduction: { method: 'GET', path: ':id/introduction' },
  },
};
