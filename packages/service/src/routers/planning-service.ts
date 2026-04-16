import {
  IntakeItemStatus,
  IntakeSourceType,
  PlanOriginType,
  PlanStatus,
  TaskPriority,
  TaskStatus,
  TaskType,
  type PlanningIntakeItem as CorePlanningIntakeItem,
  type PlanningPlan as CorePlanningPlan,
  type PlanningTask as CorePlanningTask,
  type PlanningTaskDelegation as CorePlanningTaskDelegation,
  type PlanningTodo as CorePlanningTodo,
} from '@ai-team/core';
import type {
  IPlanningService,
  PlanningIntakeItem,
  PlanningPlan,
  PlanningTask,
  PlanningTaskDelegation,
  PlanningTodo,
} from '@ai-team/api-client';
import type { IMessageStorage, IPlanningStorage } from '../storage/contracts.js';
import { BadRequestError, InternalError, NotFoundError } from '../http-errors.js';
import { randomBytes } from 'node:crypto';

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}-${randomBytes(8).toString('hex')}`;
}

export class PlanningService implements IPlanningService {
  constructor(private readonly storage: IMessageStorage) {}

  private get planningStorage(): IPlanningStorage {
    const candidate = this.storage as unknown as IPlanningStorage;
    if (typeof candidate.listPlanningPlansAsync !== 'function') {
      throw new InternalError(
        'Planning storage is not available in the configured storage backend'
      );
    }
    return candidate;
  }

  async listIntake(query?: {
    status?: string | string[];
    sourceType?: string;
    type?: string;
    limit?: number;
    offset?: number;
  }): Promise<PlanningIntakeItem[]> {
    return this.planningStorage.listPlanningIntakeItemsAsync({
      status: query?.status as any,
      sourceType: query?.sourceType,
      type: query?.type,
      limit: query?.limit,
      offset: query?.offset,
    });
  }

  async upsertIntake(
    intakeId: string,
    body: Omit<PlanningIntakeItem, 'id' | 'createdAt' | 'updatedAt'> & {
      createdAt?: string;
      updatedAt?: string;
    }
  ): Promise<PlanningIntakeItem> {
    if (!intakeId?.trim()) throw new BadRequestError('intakeId is required');
    if (!body?.sourceRef?.trim()) throw new BadRequestError('sourceRef is required');
    if (!body?.title?.trim()) throw new BadRequestError('title is required');

    const createdAt = body.createdAt ?? nowIso();
    const updatedAt = body.updatedAt ?? nowIso();

    const item: CorePlanningIntakeItem = {
      id: intakeId,
      sourceType: (body.sourceType || IntakeSourceType.LOCAL_FOLDER) as IntakeSourceType,
      sourceRef: body.sourceRef,
      sourceUrl: body.sourceUrl,
      type: (body.type || TaskType.FEATURE) as TaskType,
      title: body.title,
      description: body.description,
      status: (body.status || IntakeItemStatus.NEW) as IntakeItemStatus,
      createdAt,
      updatedAt,
      metadata: body.metadata,
    };

    await this.planningStorage.upsertPlanningIntakeItemAsync(item);
    return item;
  }

  async listPlans(query?: {
    status?: string | string[];
    assignedTo?: string;
    createdBy?: string;
    limit?: number;
    offset?: number;
  }): Promise<PlanningPlan[]> {
    return this.planningStorage.listPlanningPlansAsync({
      status: query?.status as any,
      assignedTo: query?.assignedTo,
      createdBy: query?.createdBy,
      limit: query?.limit,
      offset: query?.offset,
    });
  }

  async createPlan(body: {
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
  }): Promise<PlanningPlan> {
    if (!body?.title?.trim()) throw new BadRequestError('title is required');

    const now = nowIso();
    const plan: CorePlanningPlan = {
      id: createId('plan'),
      title: body.title,
      goal: body.goal,
      status: (body.status || PlanStatus.DRAFT) as PlanStatus,
      priority: (body.priority || TaskPriority.MEDIUM) as TaskPriority,
      createdBy: body.createdBy || 'developer',
      createdByType: body.createdByType || 'human',
      assignedTo: body.assignedTo,
      originType: (body.originType || PlanOriginType.SESSION_DISCUSSION) as PlanOriginType,
      originSessionId: body.originSessionId,
      originNoteId: body.originNoteId,
      markdownSnapshot: body.markdownSnapshot,
      createdAt: now,
      updatedAt: now,
      metadata: body.metadata,
    };

    return this.planningStorage.createPlanningPlanAsync(plan);
  }

  async getPlan(planId: string): Promise<PlanningPlan> {
    const plan = await this.planningStorage.getPlanningPlanAsync(planId);
    if (!plan) throw new NotFoundError('Plan not found');
    return plan;
  }

  async updatePlan(
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
  ): Promise<PlanningPlan> {
    const existing = await this.planningStorage.getPlanningPlanAsync(planId);
    if (!existing) throw new NotFoundError('Plan not found');

    await this.planningStorage.updatePlanningPlanAsync(planId, {
      title: body.title,
      goal: body.goal,
      status: body.status as any,
      priority: body.priority as any,
      assignedTo: body.assignedTo,
      markdownSnapshot: body.markdownSnapshot,
      metadata: body.metadata,
      updatedAt: nowIso(),
    });

    const updated = await this.planningStorage.getPlanningPlanAsync(planId);
    if (!updated) throw new NotFoundError('Plan not found');
    return updated;
  }

  async getPlanSessions(planId: string) {
    const existing = await this.planningStorage.getPlanningPlanAsync(planId);
    if (!existing) throw new NotFoundError('Plan not found');

    const visibility = await this.planningStorage.getPlanningPlanSessionVisibilityAsync(planId);
    return visibility ?? { planId, sessionIds: [] };
  }

  async listTasks(query?: {
    planId?: string;
    sessionId?: string;
    assignedTo?: string;
    status?: string | string[];
    limit?: number;
    offset?: number;
  }): Promise<PlanningTask[]> {
    return this.planningStorage.listPlanningTasksAsync({
      planId: query?.planId,
      sessionId: query?.sessionId,
      assignedTo: query?.assignedTo,
      status: query?.status,
      limit: query?.limit,
      offset: query?.offset,
    });
  }

  async createTask(body: {
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
  }): Promise<PlanningTask> {
    if (!body?.planId?.trim()) throw new BadRequestError('planId is required');
    if (!body?.sessionId?.trim()) throw new BadRequestError('sessionId is required');
    if (!body?.title?.trim()) throw new BadRequestError('title is required');

    const plan = await this.planningStorage.getPlanningPlanAsync(body.planId);
    if (!plan) throw new NotFoundError('Plan not found');

    const now = nowIso();
    const task: CorePlanningTask = {
      id: createId('plan-task'),
      planId: body.planId,
      sessionId: body.sessionId,
      title: body.title,
      description: body.description,
      type: (body.type || TaskType.FEATURE) as TaskType,
      status: (body.status || TaskStatus.NOT_STARTED) as TaskStatus,
      priority: (body.priority || TaskPriority.MEDIUM) as TaskPriority,
      createdBy: body.createdBy || 'developer',
      createdByType: body.createdByType || 'human',
      assignedTo: body.assignedTo,
      sourceActionItem: body.sourceActionItem,
      createdAt: now,
      updatedAt: now,
      metadata: body.metadata,
    };

    return this.planningStorage.createPlanningTaskAsync(task);
  }

  async getTask(taskId: string): Promise<PlanningTask> {
    const task = await this.planningStorage.getPlanningTaskAsync(taskId);
    if (!task) throw new NotFoundError('Task not found');
    return task;
  }

  async updateTask(
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
  ): Promise<PlanningTask> {
    const existing = await this.planningStorage.getPlanningTaskAsync(taskId);
    if (!existing) throw new NotFoundError('Task not found');

    await this.planningStorage.updatePlanningTaskAsync(taskId, {
      title: body.title,
      description: body.description,
      status: body.status as any,
      priority: body.priority as any,
      assignedTo: body.assignedTo,
      sourceActionItem: body.sourceActionItem,
      metadata: body.metadata,
      updatedAt: nowIso(),
    });

    const updated = await this.planningStorage.getPlanningTaskAsync(taskId);
    if (!updated) throw new NotFoundError('Task not found');
    return updated;
  }

  async listTodos(taskId: string): Promise<PlanningTodo[]> {
    return this.planningStorage.listPlanningTodosAsync(taskId);
  }

  async createTodo(
    taskId: string,
    body: {
      content: string;
      orderIndex?: number;
      done?: boolean;
      completedBy?: string;
    }
  ): Promise<PlanningTodo> {
    if (!taskId?.trim()) throw new BadRequestError('taskId is required');
    if (!body?.content?.trim()) throw new BadRequestError('content is required');

    const existingTask = await this.planningStorage.getPlanningTaskAsync(taskId);
    if (!existingTask) throw new NotFoundError('Task not found');

    const existingTodos = await this.planningStorage.listPlanningTodosAsync(taskId);
    const now = nowIso();

    const todo: CorePlanningTodo = {
      id: createId('plan-todo'),
      taskId,
      content: body.content,
      orderIndex: body.orderIndex ?? existingTodos.length,
      done: Boolean(body.done),
      completedAt: body.done ? now : undefined,
      completedBy: body.done ? body.completedBy : undefined,
      createdAt: now,
      updatedAt: now,
    };

    return this.planningStorage.createPlanningTodoAsync(todo);
  }

  async updateTodo(
    todoId: string,
    body: {
      content?: string;
      orderIndex?: number;
      done?: boolean;
      completedBy?: string;
    }
  ): Promise<{ ok: true }> {
    if (!todoId?.trim()) throw new BadRequestError('todoId is required');

    const now = nowIso();
    await this.planningStorage.updatePlanningTodoAsync(todoId, {
      content: body.content,
      orderIndex: body.orderIndex,
      done: body.done,
      completedAt: body.done === true ? now : body.done === false ? undefined : undefined,
      completedBy:
        body.done === true ? body.completedBy : body.done === false ? undefined : undefined,
      updatedAt: now,
    });

    return { ok: true };
  }

  async listDelegations(taskId: string): Promise<PlanningTaskDelegation[]> {
    return this.planningStorage.listPlanningTaskDelegationsAsync(taskId);
  }

  async createDelegation(
    taskId: string,
    body: {
      fromAgentId: string;
      toAgentId: string;
      reason?: string;
      accepted?: boolean;
    }
  ): Promise<PlanningTaskDelegation> {
    if (!taskId?.trim()) throw new BadRequestError('taskId is required');
    if (!body?.fromAgentId?.trim()) throw new BadRequestError('fromAgentId is required');
    if (!body?.toAgentId?.trim()) throw new BadRequestError('toAgentId is required');

    const existingTask = await this.planningStorage.getPlanningTaskAsync(taskId);
    if (!existingTask) throw new NotFoundError('Task not found');

    const now = nowIso();
    const accepted = Boolean(body.accepted);

    const delegation: CorePlanningTaskDelegation = {
      id: createId('plan-delegation'),
      taskId,
      fromAgentId: body.fromAgentId,
      toAgentId: body.toAgentId,
      reason: body.reason,
      delegatedAt: now,
      accepted,
      acceptedAt: accepted ? now : undefined,
    };

    return this.planningStorage.createPlanningTaskDelegationAsync(delegation);
  }
}
