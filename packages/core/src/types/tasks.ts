export enum TaskStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  BLOCKED = 'blocked',
  WAITING_APPROVAL = 'waiting_approval',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  DELEGATED = 'delegated',
}

export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent',
}

export enum TaskType {
  FEATURE = 'feature',
  BUG = 'bug',
  DOCUMENTATION = 'documentation',
}

export enum TaskExecutionMode {
  SEQUENTIAL = 'sequential',
  PARALLEL = 'parallel',
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
  createdByType: 'human' | 'agent';
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
  workflowSteps?: Omit<WorkflowStep, 'id' | 'status' | 'completedAt'>[];
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
