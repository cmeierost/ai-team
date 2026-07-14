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
  id?: number;
  timestamp: string;
  from: string;
  to?: string;
  isHuman?: boolean;
  content: string;
  context?: string[];
  tool_calls?: ToolCall[];
  suggestions?: CodeSuggestion[];
  archived?: boolean;
  hiddenFromLlm?: boolean;
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
  resultLlm?: string;
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
  list: string[];
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
  ensureAiTeamDirectoryAsync(): Promise<void>;
}

export interface IWorkspaceDiscoveryStorage {
  findAgentFilesAsync(): Promise<string[]>;
  findSkillFilesAsync(): Promise<string[]>;
  resolveAgentSkillFilePath(skillId: string): string;
  findInstructionFilesAsync(): Promise<string[]>;
}

export interface IAgentDocumentStorage {
  loadAgentAsync(filePath: string): Promise<Agent>;
  saveAgentAsync(agent: Agent): Promise<void>;
  buildAgentMarkdown(parts: AgentMarkdownParts): string;
  loadSkillAsync(filePath: string): Promise<Skill>;
  saveSkillAsync(skill: Skill): Promise<void>;
  loadAgentSkillFileAsync(filePath: string): Promise<AgentSkillFile>;
  loadInstructionFileAsync(filePath: string): Promise<InstructionFile>;
  loadAllInstructionFilesAsync(): Promise<InstructionFile[]>;
}

/** Dot-separated path string that resolves to a leaf or node inside T. */
export type ConfigPath<T> = T extends string | number | boolean | undefined | null
  ? never
  : {
      [K in keyof T]-?: K extends string
        ? T[K] extends Record<string, unknown> | undefined | null
          ? `${K}` | `${K}.${ConfigPath<NonNullable<T[K]>>}`
          : `${K}`
        : never;
    }[keyof T];

/** Resolves a dot-separated path to the corresponding type inside T. */
export type PathValue<T, P extends string> = P extends `${infer Key}.${infer Rest}`
  ? Key extends keyof T
    ? Rest extends string
      ? PathValue<NonNullable<T[Key]>, Rest>
      : never
    : never
  : P extends keyof T
    ? T[P]
    : never;

export interface IConfigurationStorage {
  /** Get the full resolved config. */
  get(): TeamConfig;
  /** Read a config value by dot-separated path. Returns undefined if not set. */
  get<Path extends ConfigPath<TeamConfig>>(path: Path): PathValue<TeamConfig, Path>;
  /**
   * Write a config value.
   * @param scope 'user' → config.user.json, undefined → config.json (default)
   */
  set<Path extends ConfigPath<TeamConfig>>(
    path: Path,
    value: PathValue<TeamConfig, Path>,
    scope?: 'user'
  ): Promise<void>;
  /** Store a secret (API key, etc.) in .env. */
  setSecret(name: string, value: string): Promise<void>;
  /** Get the developer profile (name, email, etc.). */
  getDeveloperProfile(): UserConfig['developer'] | undefined;
}

export interface IPermissionStorage {
  loadAsync(agentId: string): Promise<AgentAccessPatternSet>;
  saveAsync(agentId: string, patterns: AgentAccessPatternSet): Promise<void>;
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
