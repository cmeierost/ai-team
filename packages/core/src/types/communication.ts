import type { Agent, AgentSkillFile, InstructionFile, Skill } from './agent-models.js';
import type { TeamConfig, UserConfig } from './schemas.js';

export interface ContextItem {
  type: 'file' | 'selection' | 'note' | 'error';
  content: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

export interface ContextShare {
  from: string;
  to: string;
  items: string[];
  timestamp: string;
  reason?: string;
}

export interface FileContext {
  files: string[];
  detail: 'summary' | 'overview' | 'detailed' | 'full';
}

export interface ChatMessage {
  timestamp: string;
  from: string;
  to?: string;
  isHuman?: boolean;
  content: string;
  context?: string[];
  tool_calls?: ToolCall[];
  suggestions?: CodeSuggestion[];
  archived?: boolean;
  handoffType?: 'user-acknowledgment' | 'agent-briefing';
  targetAgentId?: string;
  handoffFromSessionId?: string;
  handoffToSessionId?: string;
  handoffId?: string;
  importance?: 'low' | 'normal' | 'high';
}

export interface ToolCall {
  id?: number;
  tool: string;
  params: Record<string, unknown>;
  result?: unknown;
  resultLlm?: unknown;
}

export interface CodeSuggestion {
  type: 'code_improvement' | 'refactor' | 'fix' | 'security';
  file: string;
  line?: number;
  description: string;
  code?: string;
}

export interface MarkdownSection {
  heading: string;
  content: string;
}

export interface AgentMarkdownParts {
  avatar?: string;
  introduction?: string;
  personalityProfile?: string[];
  skills?: Array<{ name: string; body: string }>;
  extraSections?: Array<{ heading: string; content: string }>;
}

export interface AgentAccessPatternSet {
  read: string[];
  write: string[];
}

export interface IMarkdownSectionService {
  parseMarkdownSections(markdown: string): MarkdownSection[];
  replaceOrAppendMarkdownSection(markdown: string, heading: string, newContent: string): string;
  buildAgentMarkdown(parts: AgentMarkdownParts): string;
}

export interface IWorkspaceStorage {
  fileExistsAsync(filePath: string): Promise<boolean>;
  ensureAiTeamDirectoryAsync(workspaceRoot: string): Promise<void>;
}

export interface IWorkspaceDiscoveryStorage {
  findAgentFilesAsync(workspaceRoot: string): Promise<string[]>;
  findSkillFilesAsync(workspaceRoot: string): Promise<string[]>;
  resolveAgentSkillFilePath(workspaceRoot: string, skillId: string): string;
  findInstructionFilesAsync(workspaceRoot: string): Promise<string[]>;
}

export interface IAgentDocumentStorage {
  loadAgentAsync(filePath: string): Promise<Agent>;
  saveAgentAsync(agent: Agent): Promise<void>;
  loadSkillAsync(filePath: string): Promise<Skill>;
  saveSkillAsync(skill: Skill): Promise<void>;
  loadAgentSkillFileAsync(filePath: string): Promise<AgentSkillFile>;
  loadInstructionFileAsync(filePath: string): Promise<InstructionFile>;
  loadAllInstructionFilesAsync(workspaceRoot: string): Promise<InstructionFile[]>;
}

export interface IAgentPermissionStorage {
  getAgentPermissionFilePath(workspaceRoot: string, agentId: string): string;
  loadAgentPermissionsAsync(workspaceRoot: string, agentId: string): Promise<AgentAccessPatternSet>;
  saveAgentPermissionsAsync(
    workspaceRoot: string,
    agentId: string,
    patterns: AgentAccessPatternSet
  ): Promise<void>;
}

export interface IConfigurationStorage {
  getConfigPath(workspaceRoot: string): string;
  loadTeamConfigAsync(workspaceRoot: string): Promise<TeamConfig | undefined>;
  saveTeamConfigAsync(workspaceRoot: string, config: TeamConfig): Promise<void>;
  getUserConfigPath(workspaceRoot: string): string;
  loadUserConfigAsync(workspaceRoot: string): Promise<UserConfig | undefined>;
  saveUserConfigAsync(workspaceRoot: string, config: UserConfig): Promise<UserConfig>;
  loadEffectiveConfigAsync(workspaceRoot: string): Promise<TeamConfig | undefined>;
}

export interface IEnvironmentStorage {
  getEnvPath(workspaceRoot: string): string;
  loadEnvFileAsync(workspaceRoot: string): Promise<Record<string, string>>;
  saveEnvFileAsync(workspaceRoot: string, vars: Record<string, string>): Promise<void>;
}

export interface SessionRagConfig {
  maxChunks?: number;
  similarityThreshold?: number;
  includeGitHistory?: boolean;
  embeddingModel?: string;
}

export interface ChatSession {
  id: string;
  agentIds: string[];
  agentId: string;
  developerId: string;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  title?: string;
  artifacts: string[];
  allowedFiles: string[];
  prioritizedFiles?: string[];
  tasks?: string[];
  notes?: string;
  ragConfig?: SessionRagConfig;
  previousSessionId?: string;
  mergedFromSessionIds?: string[];
}

export interface Artifact {
  id: string;
  type: 'brief' | 'summary' | 'record' | 'document';
  title: string;
  content: string;
  createdAt: string;
  createdBy: string;
  sourceSessionId: string;
  fromMessageIndex: number;
  toMessageIndex: number;
  filepath: string;
  tags?: string[];
}

export interface MeetingSummary {
  date: string;
  participants: string[];
  type: 'code-review' | 'design-discussion' | 'planning' | 'bug-investigation' | 'org-change';
  title: string;
  duration?: string;
  summary: string;
  keyPoints?: string[];
  decisions?: Decision[];
  actionItems?: ActionItem[];
  relatedFiles?: string[];
  chatSession?: string;
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
