// Browser-safe types (subset of @ai-team/core types)
// DO NOT import @ai-team/core - it uses Node.js APIs

export type ViewMode = 'hierarchy' | 'features' | 'expertise' | 'matrix';

export interface FileTreeNode {
  name: string;
  path: string;
  relativePath: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
  size?: number;
  modified?: string;
  extension?: string;
  gitignored?: boolean;
}

export interface AnnotatedFile {
  path: string;
  readable: boolean;
  listable: boolean;
  writable: boolean;
}

export interface AgentFilesResponse {
  agent: string;
  readPatterns: string[];
  writePatterns: string[];
  createPatterns?: string[];
  deletePatterns?: string[];
  files: AnnotatedFile[];
}

export interface FilePatternsResponse {
  global: {
    allowPaths: string[];
    readPaths: string[];
    writePaths: string[];
    createPaths: string[];
    deletePaths: string[];
  };
  agent?: {
    id: string;
    readPaths: string[];
    writePaths: string[];
    createPaths?: string[];
    deletePaths?: string[];
  };
}

export interface AvatarConfig {
  type?: 'url' | 'ai-generated' | 'initials';
  url?: string;
  style?: 'professional-headshot' | 'avatar' | 'illustrated';
  seed?: string;
  color?: string;
}

export interface Developer {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  portfolioUrl?: string | null;
}

export interface AgentPersonality {
  communication_style?: 'collaborative' | 'direct' | 'supportive' | 'analytical' | 'strategic';
  expertise_level?: 'executive' | 'senior' | 'mid-level' | 'junior';
  mentoring?: boolean;
}

export interface AgentLlmParams {
  temperature?: number;
  maxTokens?: number;
}

export interface AgentLlm {
  provider?: string;
  modelKey?: string;
  model?: string;
  params?: AgentLlmParams;
}

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
}

export interface AgentCapabilities {
  streaming?: boolean;
  multimodal?: boolean;
  codeExecution?: boolean;
  reasoning?: boolean;
}

export interface AgentHandoff {
  label: string;
  agent: string;
  prompt?: string;
  send?: boolean;
  model?: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  type?: 'executive' | 'leadership' | 'team-lead' | 'individual-contributor' | 'quality-gate' | 'cross-concern' | 'product';
  contextLevel?: 'task' | 'module' | 'feature' | 'repository' | 'organization';
  reportsTo?: string;
  features?: string[];
  specializations?: string[];
  tools?: string[];
  cliTools?: string[];
  canDelegate?: boolean;
  delegatesTo?: string[];
  availableFor?: string[];
  status?: 'available' | 'busy' | 'in-meeting' | 'offline';
  markdown?: string;  // Portfolio/bio content
  avatar?: AvatarConfig;
  personality?: AgentPersonality;
  pronouns?: string;
  workHours?: string;
  goal?: string;
  backstory?: string;
  skills?: AgentSkill[];
  capabilities?: AgentCapabilities;
  memory?: boolean;
  maxIterations?: number;
  llm?: AgentLlm;
  resolvedLlm?: {
    providerRef?: string;
    model?: string;
    contextWindow?: number;
    isDefault: boolean;
  };
  createdAt?: string;
  lastInteraction?: string;
  conversationCount?: number;
  handoffs?: AgentHandoff[];
  readTheseFilesFirst?: string[];
}

export type EdgeType =
  | 'reports-to'
  | 'reports-to-unresolved'
  | 'manages'
  | 'owns-feature'
  | 'contributes-to'
  | 'consults-on'
  | 'shares-context';

export interface GraphNode {
  id: string;
  type: 'agent' | 'feature';
  data: {
    label: string;
    agent?: Agent;
    feature?: any;
    role?: string;
    status?: Agent['status'];
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

export type PermissionRight = 'read' | 'write' | 'create' | 'delete' | 'list';

export interface PermissionOverlapByExtension {
  extension: string;
  fileCount: number;
  lineCount: number;
}

export interface PermissionOverlapFileOwnershipEntry {
  path: string;
  extension: string;
  lineCount: number;
  agentIds: string[];
}

export interface PermissionOverlapAgentResponsibility {
  agentId: string;
  fileCount: number;
  lineCount: number;
  byExtension: PermissionOverlapByExtension[];
}

export interface PermissionOverlapPairEntry {
  agentA: string;
  agentB: string;
  sharedFileCount: number;
  sharedLineCount: number;
  unionFileCount: number;
  overlapRatio: number;
  sharedFiles: PermissionOverlapFileOwnershipEntry[];
  byExtension: PermissionOverlapByExtension[];
}

export interface PermissionOverlapRightSummary {
  right: PermissionRight;
  totalFiles: number;
  uncoveredFiles: PermissionOverlapFileOwnershipEntry[];
  singlyOwnedFiles: PermissionOverlapFileOwnershipEntry[];
  overlappingFiles: PermissionOverlapFileOwnershipEntry[];
  agentResponsibilities: PermissionOverlapAgentResponsibility[];
  pairs: PermissionOverlapPairEntry[];
}

export interface OutsideDefaultContextRightSummary {
  fileCount: number;
  lineCount: number;
  files: PermissionOverlapFileOwnershipEntry[];
}

export interface AgentOutsideDefaultContextSummary {
  agentId: string;
  rights: Record<PermissionRight, OutsideDefaultContextRightSummary>;
}

export interface AgentFocusedOverlapPeerSummary {
  otherAgentId: string;
  sharedFileCount: number;
  sharedLineCount: number;
  overlapRatio: number;
  sharedFiles: PermissionOverlapFileOwnershipEntry[];
  byExtension: PermissionOverlapByExtension[];
}

export interface AgentFocusedOverlapRightSummary {
  right: PermissionRight;
  responsibility: PermissionOverlapAgentResponsibility;
  overlapsWith: AgentFocusedOverlapPeerSummary[];
  uniqueFiles: PermissionOverlapFileOwnershipEntry[];
  globallyUncoveredFiles: PermissionOverlapFileOwnershipEntry[];
}

export interface AgentFocusedOverlapSummary {
  agentId: string;
  rights: Record<PermissionRight, AgentFocusedOverlapRightSummary>;
}

export interface FilePermissionOverlapReport {
  kind: 'files';
  generatedAt: string;
  agentIds: string[];
  workspaceFileCount: number;
  fileTypeGroups?: Record<string, { label?: string; patterns?: string[]; extensions?: string[] }>;
  rights: Record<PermissionRight, PermissionOverlapRightSummary>;
  outsideDefaultContextByAgent: AgentOutsideDefaultContextSummary[];
  agentFocus?: AgentFocusedOverlapSummary;
}

export interface PatternPermissionOverlapReport {
  kind: 'patterns';
  generatedAt: string;
  agentIds: string[];
}

export type PermissionOverlapReport = FilePermissionOverlapReport | PatternPermissionOverlapReport;

export type FileTypeCategory = 'code' | 'documentation' | 'configuration' | 'tests' | 'assets' | 'other';

export interface FileTypeSummary {
  category: FileTypeCategory;
  fileCount: number;
  lineCount: number;
  extensions: string[];
}

export interface FileEndingSummary {
  extension: string;
  fileCount: number;
  lineCount: number;
  category: FileTypeCategory;
}

export interface PermissionOverlapRegion {
  id: string;
  label: string;
  focusAgentId: string;
  peerAgentIds: string[];
  totalFiles: number;
  totalLines: number;
  overlapRatio: number;
  sharedRights: PermissionRight[];
  rightFileCounts: Record<PermissionRight, number>;
  rightLineCounts: Record<PermissionRight, number>;
  rightFolderCounts?: Partial<Record<PermissionRight, number>>;
  rightOverlapRatio?: Record<PermissionRight, number>;
  rightSharedFiles?: Partial<Record<PermissionRight, PermissionOverlapFileOwnershipEntry[]>>;
  rightFileEndingSummary?: Partial<Record<PermissionRight, FileEndingSummary[]>>;
  rightFileTypeSummary?: Partial<Record<PermissionRight, FileTypeSummary[]>>;
  fileEndingSummary: FileEndingSummary[];
  fileTypeSummary: FileTypeSummary[];
  sharedFiles: PermissionOverlapFileOwnershipEntry[];
}

export interface PermissionSuggestion {
  id: string;
  title: string;
  severity: 'high' | 'medium' | 'low';
  rationale: string;
  affectedAgentIds: string[];
  affectedRights: PermissionRight[];
  fileScope: string[];
  fileTypeSummary: FileTypeSummary[];
}

export interface PermissionAgentResponsibilitySummary {
  rightFileCounts: Record<PermissionRight, number>;
  rightLineCounts: Record<PermissionRight, number>;
  rightFolderCounts?: Partial<Record<PermissionRight, number>>;
}

export interface PermissionRightUncoveredSummary {
  fileCount: number;
  lineCount: number;
  folderCount: number;
}

export interface PermissionAnalysisSummary {
  totalAgents: number;
  totalOverlappingPairs: number;
  totalGloballyUncoveredFiles: number;
  totalMultiWriteFiles: number;
  strongestOverlapRegionId?: string;
}

export interface PermissionAnalysisView {
  generatedAt: string;
  selectedFileTypeGroupId: string;
  fileTypeGroups: Array<{ id: string; label: string }>;
  workspaceFileCount: number;
  workspaceUncoveredFileCount: number;
  workspaceCodeFileCount: number;
  workspaceCodeLineCount: number;
  workspaceCodeUncoveredFileCount: number;
  workspaceCodeUncoveredByRight: Record<PermissionRight, number>;
  workspaceDocumentationFileCount: number;
  workspaceDocumentationUncoveredFileCount: number;
  workspaceDocumentationUncoveredByRight: Record<PermissionRight, number>;
  workspaceBinaryFileCount: number;
  workspaceBinaryUncoveredFileCount: number;
  workspaceBinaryUncoveredByRight: Record<PermissionRight, number>;
  agentIds: string[];
  defaultContextByRight: Record<PermissionRight, number>;
  defaultReadContextFileCount: number;
  defaultReadContextLineCount: number;
  totalAgentContextByRight: Record<PermissionRight, number>;
  globallyUncoveredFiles: PermissionOverlapFileOwnershipEntry[];
  uncoveredFileEndings: FileEndingSummary[];
  uncoveredFileTypes: FileTypeSummary[];
  rightUncovered: Record<PermissionRight, PermissionRightUncoveredSummary>;
  agentResponsibilities: Record<string, PermissionAgentResponsibilitySummary>;
  outsideDefaultContextByAgent: Record<string, Record<PermissionRight, OutsideDefaultContextRightSummary>>;
  regions: PermissionOverlapRegion[];
  suggestions: PermissionSuggestion[];
  summary: PermissionAnalysisSummary;
}

export interface ChatMessage {
  from: string; // Agent ID or developer ID (e.g., 'clemens-meier')
  to?: string; // Target agent ID (used for handoff messages)
  isHuman?: boolean; // True if message is from human developer
  content: string;
  timestamp: string;
  archived?: boolean;
  handoffType?: 'user-acknowledgment' | 'agent-briefing'; // Type of handoff message
  targetAgentId?: string; // Target agent for briefing messages
  // Cross-session handoff tracking (added with /thread API)
  handoffId?: string;              // UUID shared by all messages in one handoff event
  handoffFromSessionId?: string;   // Session this briefing came FROM
  handoffToSessionId?: string;     // Session this briefing is directed TO
}

export interface SessionActivatedTool {
  toolName: string;
  toolPhase?: 'request' | 'start' | 'result' | 'error' | 'denied';
  message?: string;
  toolResult?: {
    toolName: string;
    outcome: 'result' | 'error' | 'denied';
    result?: unknown;
    /** LLM-formatted representation — what was injected into the model's context window. */
    resultLlm?: unknown;
    denial?: {
      kind: 'user-denied' | 'policy-denied' | 'execution-failed';
      reasonCode: string;
      message: string;
      blockedPaths?: string[];
      alternativeContexts?: Array<{ contextId: string; allowedPaths: string[] }>;
      handoffRecommendation?: {
        possible: boolean;
        requiresUserApproval: true;
        contexts: Array<{ contextId: string; allowedPaths: string[] }>;
      };
    };
  };
  toolDenial?: {
    kind: 'user-denied' | 'policy-denied' | 'execution-failed';
    reasonCode: string;
    message: string;
    blockedPaths?: string[];
    alternativeContexts?: Array<{ contextId: string; allowedPaths: string[] }>;
    handoffRecommendation?: {
      possible: boolean;
      requiresUserApproval: true;
      contexts: Array<{ contextId: string; allowedPaths: string[] }>;
    };
  };
  timestamp: string;
}

export interface ChatSession {
  id: string;  // e.g., 'session-2026-02-27-abc123'
  agentId: string;      // deprecated — use agentIds[0]
  agentIds?: string[];  // Primary agent IDs for this session
  developerId: string;  // e.g., 'clemens-meier'
  title?: string;       // Optional session title
  startedAt: string;    // ISO timestamp
  lastActivityAt: string;  // ISO timestamp
  messageCount: number;
  artifacts: string[];  // Artifact IDs or paths in context
  allowedFiles: string[];  // Files agent can access in this session
  notes?: string;
  activatedTools?: SessionActivatedTool[];
  previousSessionId?: string;      // ID of session this was handed off from
  mergedFromSessionIds?: string[] | null;  // Sessions merged into this one
}

/** One directed handoff edge in the session thread graph */
export interface HandoffEdge {
  handoffId: string;
  fromSessionId: string | null;  // null if source session was deleted
  toSessionId: string | null;    // null if target session was deleted
  fromAgentIds: string[];
  toAgentIds: string[];
}

/** A single node in the session thread, as returned by GET /api/sessions/:id/thread */
export interface SessionNode {
  sessionId: string;
  agentIds: string[];
  agentNames: string[];
  developerId: string | null;
  title: string | null;
  startedAt: string;
  lastActivityAt: string;
  previousSessionId: string | null;
  mergedFromSessionIds: string[] | null;
  messageCount: number;
  messages: ChatMessage[];
}

/** Full session thread returned by GET /api/sessions/:id/thread */
export interface SessionThread {
  rootSessionId: string;
  currentSessionId: string;
  depth: number;
  handoffs: HandoffEdge[];
  sessions: SessionNode[];
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

// Task Management Types
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
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
  description?: string;
  createdAt: string;
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
  completedAt?: string;
}

export interface TaskDelegationRecord {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  delegatedAt: string;
  reason?: string;
  accepted: boolean;
  acceptedAt?: string;
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
  approvedAt?: string;
  parentTaskId?: string;
  subtaskIds?: string[];
  executionMode?: TaskExecutionMode;
  workflowSteps?: WorkflowStep[];
  estimatedHours?: number;
  actualHours?: number;
  timeLog?: TimeLogEntry[];
  dueDate?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  tags?: string[];
  sessionId?: string;
  artifactIds?: string[];
  delegationHistory?: TaskDelegationRecord[];
  delegatedTo?: string;
  blockedReason?: string;
  blockedBy?: string[];
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
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

export interface SystemInfo {
  apiUrl: string;
  workspace: string;
  branch: string | null;
  package: {
    name: string | null;
    version: string | null;
    description: string | null;
  } | null;
}
