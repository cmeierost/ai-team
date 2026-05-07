/**
 * Shared session and chat types.
 * These are browser-safe (no Node.js-specific imports) and are used by
 * both the contract router and the HTTP client.
 */

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

export interface ChatMessage {
  id?: number;
  from: string;
  to?: string;
  isHuman?: boolean;
  content: string;
  timestamp: string;
  archived?: boolean;
  hiddenFromLlm?: boolean;
  handoffType?: 'user-acknowledgment' | 'agent-briefing';
  targetAgentId?: string;
  handoffId?: string;
  handoffFromSessionId?: string;
  handoffToSessionId?: string;
}

export interface SessionToolDenial {
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
}

export interface SessionToolResult {
  id?: number;
  toolName: string;
  outcome: 'request' | 'start' | 'result' | 'error' | 'denied';
  request?: unknown;
  commandResponse?: CommandResponse;
  resultLlm?: unknown;
  denial?: SessionToolDenial;
}

export interface CommandResponseError {
  code?: string;
  details?: unknown;
}

export interface CommandResponse<T = unknown> {
  status: 'ok' | 'error';
  message: string;
  data?: T;
  saveable?: unknown;
  error?: CommandResponseError;
}

export function isCommandResponse(value: unknown): value is CommandResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CommandResponse>;
  return (
    (candidate.status === 'ok' || candidate.status === 'error') &&
    typeof candidate.message === 'string'
  );
}

export interface SessionActivatedTool {
  toolName: string;
  toolCallId?: string;
  toolPhase?: 'request' | 'start' | 'result' | 'error' | 'denied';
  message?: string;
  toolResult?: SessionToolResult;
  toolDenial?: SessionToolDenial;
  timestamp: string;
  /** Monotonic server-assigned sequence for deterministic ordering. */
  toolEventSeq?: number;
}

export interface ChatSession {
  id: string;
  agentId: string;
  agentIds?: string[];
  developerId: string;
  title?: string;
  startedAt: string;
  lastActivityAt: string;
  messageCount: number;
  artifacts: string[];
  allowedFiles: string[];
  notes?: string;
  activatedTools?: SessionActivatedTool[];
  previousSessionId?: string;
  mergedFromSessionIds?: string[] | null;
  messages?: ChatMessage[];
}

export interface NoteAttachment {
  id: string;
  fileName: string;
  filePath: string;
  contentType?: string;
  sizeBytes: number;
  description?: string;
}

export interface NoteAttachmentInput {
  fileName: string;
  contentBase64: string;
  contentType?: string;
  sizeBytes?: number;
  description?: string;
}

export interface RetainedNoteAttachmentInput {
  id: string;
}

export type NoteAttachmentUpdateInput = NoteAttachmentInput | RetainedNoteAttachmentInput;

export interface Note {
  id: string;
  agentId: string;
  sessionId?: string;
  sharedSessionIds?: string[];
  title?: string;
  content: string;
  compactedContent?: string;
  hiddenFromLlm: boolean;
  showOnDashboard: boolean;
  tags?: string[];
  attachments?: NoteAttachment[];
  attachment?: NoteAttachment;
  createdAt: string;
  updatedAt: string;
}

export interface NoteMarkdownExportResult {
  markdownPath: string;
  attachmentPath?: string;
  attachmentPaths?: string[];
}

export type NoteSessionShareKind = 'compression' | 'linked';

export interface NoteSessionShare {
  noteId: string;
  sessionId: string;
  anchorMessageId?: number;
  kind?: NoteSessionShareKind;
  active: boolean;
  fromMessageId?: number;
  toMessageId?: number;
  createdAt: string;
}

export type IntakeSourceType = 'local_folder' | 'github' | 'gitlab' | 'jira' | 'other';
export type IntakeItemStatus = 'new' | 'triaged' | 'converted_to_plan' | 'dismissed';
export type PlanStatus = 'draft' | 'active' | 'blocked' | 'completed' | 'cancelled';
export type PlanOriginType = 'intake' | 'session_discussion' | 'note' | 'markdown_import';

export interface PlanningIntakeItem {
  id: string;
  sourceType: IntakeSourceType;
  sourceRef: string;
  sourceUrl?: string;
  type: string;
  title: string;
  description?: string;
  status: IntakeItemStatus;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface PlanningPlan {
  id: string;
  title: string;
  goal?: string;
  status: PlanStatus;
  priority: string;
  createdBy: string;
  createdByType: 'human' | 'agent';
  assignedTo?: string;
  originType: PlanOriginType;
  originSessionId?: string;
  originNoteId?: string;
  markdownSnapshot?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface PlanningTask {
  id: string;
  planId: string;
  sessionId: string;
  title: string;
  description?: string;
  type: string;
  status: string;
  priority: string;
  createdBy: string;
  createdByType: 'human' | 'agent';
  assignedTo?: string;
  sourceActionItem?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface PlanningTodo {
  id: string;
  taskId: string;
  content: string;
  orderIndex: number;
  done: boolean;
  completedAt?: string;
  completedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanningTaskDelegation {
  id: string;
  taskId: string;
  fromAgentId: string;
  toAgentId: string;
  reason?: string;
  delegatedAt: string;
  accepted: boolean;
  acceptedAt?: string;
}

export interface PlanningPlanSessionVisibility {
  planId: string;
  sessionIds: string[];
}

export interface MessageSessionLink {
  messageId: number;
  sessionId: string;
  createdAt: string;
}

export interface HandoffEdge {
  handoffId: string;
  fromSessionId: string | null;
  toSessionId: string | null;
  fromAgentIds: string[];
  toAgentIds: string[];
}

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

export interface SessionThread {
  rootSessionId: string;
  currentSessionId: string;
  depth: number;
  handoffs: HandoffEdge[];
  sessions: SessionNode[];
}

export interface SessionDeleteImpactTransfer {
  noteId: string;
  title?: string;
  targetSessionId: string;
  remainingSharedSessionIds: string[];
}

export interface SessionDeleteImpactBlockingNote {
  noteId: string;
  title?: string;
}

export interface SessionDeleteImpact {
  sessionId: string;
  transferableNotes: SessionDeleteImpactTransfer[];
  unsharedOwnedNotes: SessionDeleteImpactBlockingNote[];
}

export interface MessageStats {
  total: number;
  archived: number;
  active: number;
  byAgent: Record<string, number>;
}

export interface ApiError {
  error: string;
  message?: string;
  details?: unknown;
}

export interface WorkflowDefinitionTransition {
  event: string;
  target?: string;
  guard?: string;
}

export interface WorkflowDefinitionState {
  type?: 'final';
  invoke?: {
    src?: string;
  };
  transitions: WorkflowDefinitionTransition[];
}

export interface WorkflowDefinitionDocument {
  format: 'workflow/v1';
  id: string;
  initial: string;
  states: Record<string, WorkflowDefinitionState>;
}

export interface WorkflowDefinitionApiResponse {
  workflowId: string;
  format: 'workflow/v1';
  definitionJson: WorkflowDefinitionDocument;
  definitionYaml: string;
}
