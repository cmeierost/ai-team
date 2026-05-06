import type {
  IntakeItemStatus,
  PlanStatus,
  PlanningIntakeItem,
  PlanningPlan,
  PlanningPlanSessionVisibility,
  PlanningTask,
  PlanningTaskDelegation,
  PlanningTodo,
} from '../types/index.js';

export interface PlanningIntakeFilter {
  status?: IntakeItemStatus | IntakeItemStatus[];
  sourceType?: string;
  type?: string;
  limit?: number;
  offset?: number;
}

export interface PlanningPlanFilter {
  status?: PlanStatus | PlanStatus[];
  assignedTo?: string;
  createdBy?: string;
  limit?: number;
  offset?: number;
}

export interface PlanningTaskFilter {
  planId?: string;
  sessionId?: string;
  assignedTo?: string;
  status?: string | string[];
  limit?: number;
  offset?: number;
}

export interface IPlanningRepository {
  listPlanningIntakeItemsAsync(filter?: PlanningIntakeFilter): Promise<PlanningIntakeItem[]>;
  upsertPlanningIntakeItemAsync(item: PlanningIntakeItem): Promise<void>;

  createPlanningPlanAsync(plan: PlanningPlan): Promise<PlanningPlan>;
  getPlanningPlanAsync(planId: string): Promise<PlanningPlan | null>;
  listPlanningPlansAsync(filter?: PlanningPlanFilter): Promise<PlanningPlan[]>;
  updatePlanningPlanAsync(planId: string, updates: Partial<PlanningPlan>): Promise<void>;
  getPlanningPlanSessionVisibilityAsync(
    planId: string
  ): Promise<PlanningPlanSessionVisibility | null>;

  createPlanningTaskAsync(task: PlanningTask): Promise<PlanningTask>;
  getPlanningTaskAsync(taskId: string): Promise<PlanningTask | null>;
  listPlanningTasksAsync(filter?: PlanningTaskFilter): Promise<PlanningTask[]>;
  updatePlanningTaskAsync(taskId: string, updates: Partial<PlanningTask>): Promise<void>;

  createPlanningTodoAsync(todo: PlanningTodo): Promise<PlanningTodo>;
  listPlanningTodosAsync(taskId: string): Promise<PlanningTodo[]>;
  updatePlanningTodoAsync(todoId: string, updates: Partial<PlanningTodo>): Promise<void>;

  createPlanningTaskDelegationAsync(
    delegation: PlanningTaskDelegation
  ): Promise<PlanningTaskDelegation>;
  listPlanningTaskDelegationsAsync(taskId: string): Promise<PlanningTaskDelegation[]>;
}
