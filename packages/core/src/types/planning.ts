import { TaskPriority, TaskStatus, TaskType } from './tasks.js';

export enum IntakeSourceType {
  LOCAL_FOLDER = 'local_folder',
  GITHUB = 'github',
  GITLAB = 'gitlab',
  JIRA = 'jira',
  OTHER = 'other',
}

export enum IntakeItemStatus {
  NEW = 'new',
  TRIAGED = 'triaged',
  CONVERTED_TO_PLAN = 'converted_to_plan',
  DISMISSED = 'dismissed',
}

export enum PlanStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  BLOCKED = 'blocked',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum PlanOriginType {
  INTAKE = 'intake',
  SESSION_DISCUSSION = 'session_discussion',
  NOTE = 'note',
  MARKDOWN_IMPORT = 'markdown_import',
}

export interface IntakeProviderQuery {
  includeDismissed?: boolean;
  limit?: number;
}

export interface IntakeProvider {
  id: string;
  sourceType: IntakeSourceType;
  listItemsAsync(query?: IntakeProviderQuery): Promise<PlanningIntakeItem[]>;
  getItemBySourceRefAsync(sourceRef: string): Promise<PlanningIntakeItem | null>;
}

export interface PlanningIntakeItem {
  id: string;
  sourceType: IntakeSourceType;
  sourceRef: string;
  sourceUrl?: string;
  type: TaskType;
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
  priority: TaskPriority;
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
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
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
