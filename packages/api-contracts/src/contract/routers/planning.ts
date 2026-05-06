import type { ApiDescription } from '@ts-http/core';
import type {
  PlanningIntakeItem,
  PlanningPlan,
  PlanningPlanSessionVisibility,
  PlanningTask,
  PlanningTaskDelegation,
  PlanningTodo,
} from '../shared-types.js';

export interface IPlanningService {
  listIntake(query?: {
    status?: string | string[];
    sourceType?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<PlanningIntakeItem[]>;

  upsertIntake(
    intakeId: string,
    body: Omit<PlanningIntakeItem, 'id' | 'createdAt' | 'updatedAt'> & {
      createdAt?: string;
      updatedAt?: string;
    }
  ): Promise<PlanningIntakeItem>;

  listPlans(query?: {
    status?: string | string[];
    assignedTo?: string;
    createdBy?: string;
    limit?: number;
    offset?: number;
  }): Promise<PlanningPlan[]>;

  createPlan(body: {
    title: string;
    goal?: string;
    status?: string;
    priority?: string;
    createdBy?: string;
    createdByType?: 'human' | 'agent';
    assignedTo?: string;
    originType?: string;
    originSessionId?: string;
    originNoteId?: string;
    markdownSnapshot?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PlanningPlan>;

  getPlan(planId: string): Promise<PlanningPlan>;

  updatePlan(
    planId: string,
    body: {
      title?: string;
      goal?: string;
      status?: string;
      priority?: string;
      assignedTo?: string;
      markdownSnapshot?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<PlanningPlan>;

  getPlanSessions(planId: string): Promise<PlanningPlanSessionVisibility>;

  listTasks(query?: {
    planId?: string;
    sessionId?: string;
    assignedTo?: string;
    status?: string | string[];
    limit?: number;
    offset?: number;
  }): Promise<PlanningTask[]>;

  createTask(body: {
    planId: string;
    sessionId: string;
    title: string;
    description?: string;
    type?: string;
    status?: string;
    priority?: string;
    createdBy?: string;
    createdByType?: 'human' | 'agent';
    assignedTo?: string;
    sourceActionItem?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PlanningTask>;

  getTask(taskId: string): Promise<PlanningTask>;

  updateTask(
    taskId: string,
    body: {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      assignedTo?: string;
      sourceActionItem?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<PlanningTask>;

  listTodos(taskId: string): Promise<PlanningTodo[]>;

  createTodo(
    taskId: string,
    body: {
      content: string;
      orderIndex?: number;
      done?: boolean;
      completedBy?: string;
    }
  ): Promise<PlanningTodo>;

  updateTodo(
    todoId: string,
    body: {
      content?: string;
      orderIndex?: number;
      done?: boolean;
      completedBy?: string;
    }
  ): Promise<{ ok: true }>;

  listDelegations(taskId: string): Promise<PlanningTaskDelegation[]>;

  createDelegation(
    taskId: string,
    body: {
      fromAgentId: string;
      toAgentId: string;
      reason?: string;
      accepted?: boolean;
    }
  ): Promise<PlanningTaskDelegation>;
}

export const planningDesc: ApiDescription<IPlanningService> = {
  subRoute: '/api/planning',
  mapping: {
    listIntake: { method: 'GET', path: 'intake' },
    upsertIntake: { method: 'PUT', path: 'intake/:intakeId' },

    listPlans: { method: 'GET', path: 'plans' },
    createPlan: { method: 'POST', path: 'plans' },
    getPlan: { method: 'GET', path: 'plans/:planId' },
    updatePlan: { method: 'PUT', path: 'plans/:planId' },
    getPlanSessions: { method: 'GET', path: 'plans/:planId/sessions' },

    listTasks: { method: 'GET', path: 'tasks' },
    createTask: { method: 'POST', path: 'tasks' },
    getTask: { method: 'GET', path: 'tasks/:taskId' },
    updateTask: { method: 'PUT', path: 'tasks/:taskId' },

    listTodos: { method: 'GET', path: 'tasks/:taskId/todos' },
    createTodo: { method: 'POST', path: 'tasks/:taskId/todos' },
    updateTodo: { method: 'PUT', path: 'todos/:todoId' },

    listDelegations: { method: 'GET', path: 'tasks/:taskId/delegations' },
    createDelegation: { method: 'POST', path: 'tasks/:taskId/delegations' },
  },
};
