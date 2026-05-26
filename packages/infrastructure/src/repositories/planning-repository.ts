import type {
  IPlanningStorage,
  PlanningIntakeFilter,
  PlanningPlanFilter,
  PlanningTaskFilter,
  PlanningIntakeItem,
  PlanningPlan,
  PlanningPlanSessionVisibility,
  PlanningTask,
  PlanningTaskDelegation,
  PlanningTodo,
} from '@ai-team/core';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { SqliteDrizzleDatabase } from '../storage/sqlite/connection.js';
import * as dbSchema from '../storage/sqlite/schema.js';

type EnsureReadyAsync = () => Promise<void>;
type GetDb = () => SqliteDrizzleDatabase;

export class PlanningRepository implements IPlanningStorage {
  constructor(
    private readonly ensureReadyAsync: EnsureReadyAsync,
    private readonly getDb: GetDb
  ) {}

  private db() {
    return this.getDb();
  }

  async listPlanningIntakeItemsAsync(filter?: PlanningIntakeFilter): Promise<PlanningIntakeItem[]> {
    await this.ensureReadyAsync();
    const conditions: any[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(inArray(dbSchema.planningIntakeItems.status, statuses));
    }

    if (filter?.sourceType) {
      conditions.push(eq(dbSchema.planningIntakeItems.sourceType, filter.sourceType));
    }

    if (filter?.type) {
      conditions.push(eq(dbSchema.planningIntakeItems.type, filter.type));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    let query: any = this.db().select().from(dbSchema.planningIntakeItems);
    if (whereClause) {
      query = query.where(whereClause);
    }

    query = query.orderBy(desc(dbSchema.planningIntakeItems.updatedAt));
    if (filter?.limit) query = query.limit(filter.limit);
    if (filter?.offset) query = query.offset(filter.offset);

    const rows = await query;

    return rows.map((row: any) => ({
      id: row.id,
      sourceType: row.sourceType,
      sourceRef: row.sourceRef,
      sourceUrl: row.sourceUrl || undefined,
      type: row.type,
      title: row.title,
      description: row.description || undefined,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
    }));
  }

  async upsertPlanningIntakeItemAsync(item: PlanningIntakeItem): Promise<void> {
    await this.ensureReadyAsync();
    this.db()
      .insert(dbSchema.planningIntakeItems)
      .values({
        id: item.id,
        sourceType: item.sourceType,
        sourceRef: item.sourceRef,
        sourceUrl: item.sourceUrl || null,
        type: item.type,
        title: item.title,
        description: item.description || null,
        status: item.status,
        metadataJson: item.metadata ? JSON.stringify(item.metadata) : null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })
      .onConflictDoUpdate({
        target: dbSchema.planningIntakeItems.id,
        set: {
          sourceType: item.sourceType,
          sourceRef: item.sourceRef,
          sourceUrl: item.sourceUrl || null,
          type: item.type,
          title: item.title,
          description: item.description || null,
          status: item.status,
          metadataJson: item.metadata ? JSON.stringify(item.metadata) : null,
          updatedAt: item.updatedAt,
        },
      })
      .run();
  }

  async createPlanningPlanAsync(plan: PlanningPlan): Promise<PlanningPlan> {
    await this.ensureReadyAsync();
    this.db()
      .insert(dbSchema.planningPlans)
      .values({
        id: plan.id,
        title: plan.title,
        goal: plan.goal || null,
        status: plan.status,
        priority: plan.priority,
        createdBy: plan.createdBy,
        createdByType: plan.createdByType,
        assignedTo: plan.assignedTo || null,
        originType: plan.originType,
        originSessionId: plan.originSessionId || null,
        originNoteId: plan.originNoteId || null,
        markdownSnapshot: plan.markdownSnapshot || null,
        metadataJson: plan.metadata ? JSON.stringify(plan.metadata) : null,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      })
      .run();

    return plan;
  }

  async getPlanningPlanAsync(planId: string): Promise<PlanningPlan | null> {
    await this.ensureReadyAsync();
    const row = await this.db()
      .select()
      .from(dbSchema.planningPlans)
      .where(eq(dbSchema.planningPlans.id, planId))
      .get();

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      title: row.title,
      goal: row.goal || undefined,
      status: row.status as PlanningPlan['status'],
      priority: row.priority as PlanningPlan['priority'],
      createdBy: row.createdBy,
      createdByType: row.createdByType as PlanningPlan['createdByType'],
      assignedTo: row.assignedTo || undefined,
      originType: row.originType as PlanningPlan['originType'],
      originSessionId: row.originSessionId || undefined,
      originNoteId: row.originNoteId || undefined,
      markdownSnapshot: row.markdownSnapshot || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
    };
  }

  async listPlanningPlansAsync(filter?: PlanningPlanFilter): Promise<PlanningPlan[]> {
    await this.ensureReadyAsync();
    const conditions: any[] = [];

    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(inArray(dbSchema.planningPlans.status, statuses));
    }

    if (filter?.assignedTo) {
      conditions.push(eq(dbSchema.planningPlans.assignedTo, filter.assignedTo));
    }

    if (filter?.createdBy) {
      conditions.push(eq(dbSchema.planningPlans.createdBy, filter.createdBy));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    let query: any = this.db().select().from(dbSchema.planningPlans);
    if (whereClause) {
      query = query.where(whereClause);
    }

    query = query.orderBy(desc(dbSchema.planningPlans.updatedAt));
    if (filter?.limit) query = query.limit(filter.limit);
    if (filter?.offset) query = query.offset(filter.offset);

    const rows = await query;

    return rows.map((row: any) => ({
      id: row.id,
      title: row.title,
      goal: row.goal || undefined,
      status: row.status as PlanningPlan['status'],
      priority: row.priority as PlanningPlan['priority'],
      createdBy: row.createdBy,
      createdByType: row.createdByType as PlanningPlan['createdByType'],
      assignedTo: row.assignedTo || undefined,
      originType: row.originType as PlanningPlan['originType'],
      originSessionId: row.originSessionId || undefined,
      originNoteId: row.originNoteId || undefined,
      markdownSnapshot: row.markdownSnapshot || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
    }));
  }

  async updatePlanningPlanAsync(planId: string, updates: Partial<PlanningPlan>): Promise<void> {
    await this.ensureReadyAsync();
    const planUpdates: Record<string, unknown> = {};

    if (updates.title !== undefined) {
      planUpdates.title = updates.title;
    }
    if (updates.goal !== undefined) {
      planUpdates.goal = updates.goal || null;
    }
    if (updates.status !== undefined) {
      planUpdates.status = updates.status;
    }
    if (updates.priority !== undefined) {
      planUpdates.priority = updates.priority;
    }
    if (updates.assignedTo !== undefined) {
      planUpdates.assignedTo = updates.assignedTo || null;
    }
    if (updates.markdownSnapshot !== undefined) {
      planUpdates.markdownSnapshot = updates.markdownSnapshot || null;
    }
    if (updates.metadata !== undefined) {
      planUpdates.metadataJson = updates.metadata ? JSON.stringify(updates.metadata) : null;
    }
    if (updates.updatedAt !== undefined) {
      planUpdates.updatedAt = updates.updatedAt;
    }

    if (Object.keys(planUpdates).length === 0) {
      return;
    }

    await this.db()
      .update(dbSchema.planningPlans)
      .set(planUpdates)
      .where(eq(dbSchema.planningPlans.id, planId));
  }

  async getPlanningPlanSessionVisibilityAsync(
    planId: string
  ): Promise<PlanningPlanSessionVisibility | null> {
    await this.ensureReadyAsync();
    const rows = await this.db()
      .selectDistinct({ session_id: dbSchema.planningTasks.sessionId })
      .from(dbSchema.planningTasks)
      .where(eq(dbSchema.planningTasks.planId, planId))
      .orderBy(asc(dbSchema.planningTasks.sessionId));

    if (rows.length === 0) {
      return null;
    }
    return {
      planId,
      sessionIds: rows.map((row: any) => row.session_id),
    };
  }

  async createPlanningTaskAsync(task: PlanningTask): Promise<PlanningTask> {
    await this.ensureReadyAsync();
    this.db()
      .insert(dbSchema.planningTasks)
      .values({
        id: task.id,
        planId: task.planId,
        sessionId: task.sessionId,
        title: task.title,
        description: task.description || null,
        type: task.type,
        status: task.status,
        priority: task.priority,
        createdBy: task.createdBy,
        createdByType: task.createdByType,
        assignedTo: task.assignedTo || null,
        sourceActionItem: task.sourceActionItem || null,
        metadataJson: task.metadata ? JSON.stringify(task.metadata) : null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      })
      .run();

    return task;
  }

  async getPlanningTaskAsync(taskId: string): Promise<PlanningTask | null> {
    await this.ensureReadyAsync();
    const row = await this.db()
      .select()
      .from(dbSchema.planningTasks)
      .where(eq(dbSchema.planningTasks.id, taskId))
      .get();

    if (!row) {
      return null;
    }
    return {
      id: row.id,
      planId: row.planId,
      sessionId: row.sessionId,
      title: row.title,
      description: row.description || undefined,
      type: row.type as PlanningTask['type'],
      status: row.status as PlanningTask['status'],
      priority: row.priority as PlanningTask['priority'],
      createdBy: row.createdBy,
      createdByType: row.createdByType as PlanningTask['createdByType'],
      assignedTo: row.assignedTo || undefined,
      sourceActionItem: row.sourceActionItem || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
    };
  }

  async listPlanningTasksAsync(filter?: PlanningTaskFilter): Promise<PlanningTask[]> {
    await this.ensureReadyAsync();
    const conditions: any[] = [];

    if (filter?.planId) {
      conditions.push(eq(dbSchema.planningTasks.planId, filter.planId));
    }
    if (filter?.sessionId) {
      conditions.push(eq(dbSchema.planningTasks.sessionId, filter.sessionId));
    }
    if (filter?.assignedTo) {
      conditions.push(eq(dbSchema.planningTasks.assignedTo, filter.assignedTo));
    }
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      conditions.push(inArray(dbSchema.planningTasks.status, statuses));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
    let query: any = this.db().select().from(dbSchema.planningTasks);
    if (whereClause) {
      query = query.where(whereClause);
    }

    query = query.orderBy(desc(dbSchema.planningTasks.updatedAt));
    if (filter?.limit) query = query.limit(filter.limit);
    if (filter?.offset) query = query.offset(filter.offset);

    const rows = await query;

    return rows.map((row: any) => ({
      id: row.id,
      planId: row.planId,
      sessionId: row.sessionId,
      title: row.title,
      description: row.description || undefined,
      type: row.type as PlanningTask['type'],
      status: row.status as PlanningTask['status'],
      priority: row.priority as PlanningTask['priority'],
      createdBy: row.createdBy,
      createdByType: row.createdByType as PlanningTask['createdByType'],
      assignedTo: row.assignedTo || undefined,
      sourceActionItem: row.sourceActionItem || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : undefined,
    }));
  }

  async updatePlanningTaskAsync(taskId: string, updates: Partial<PlanningTask>): Promise<void> {
    await this.ensureReadyAsync();
    const taskUpdates: Record<string, unknown> = {};

    if (updates.title !== undefined) {
      taskUpdates.title = updates.title;
    }
    if (updates.description !== undefined) {
      taskUpdates.description = updates.description || null;
    }
    if (updates.status !== undefined) {
      taskUpdates.status = updates.status;
    }
    if (updates.priority !== undefined) {
      taskUpdates.priority = updates.priority;
    }
    if (updates.assignedTo !== undefined) {
      taskUpdates.assignedTo = updates.assignedTo || null;
    }
    if (updates.sourceActionItem !== undefined) {
      taskUpdates.sourceActionItem = updates.sourceActionItem || null;
    }
    if (updates.metadata !== undefined) {
      taskUpdates.metadataJson = updates.metadata ? JSON.stringify(updates.metadata) : null;
    }
    if (updates.updatedAt !== undefined) {
      taskUpdates.updatedAt = updates.updatedAt;
    }

    if (Object.keys(taskUpdates).length === 0) {
      return;
    }

    await this.db()
      .update(dbSchema.planningTasks)
      .set(taskUpdates)
      .where(eq(dbSchema.planningTasks.id, taskId));
  }

  async createPlanningTodoAsync(todo: PlanningTodo): Promise<PlanningTodo> {
    await this.ensureReadyAsync();
    this.db()
      .insert(dbSchema.planningTodos)
      .values({
        id: todo.id,
        taskId: todo.taskId,
        content: todo.content,
        orderIndex: todo.orderIndex,
        done: todo.done ? 1 : 0,
        completedAt: todo.completedAt || null,
        completedBy: todo.completedBy || null,
        createdAt: todo.createdAt,
        updatedAt: todo.updatedAt,
      })
      .run();

    return todo;
  }

  async listPlanningTodosAsync(taskId: string): Promise<PlanningTodo[]> {
    await this.ensureReadyAsync();
    const rows = await this.db()
      .select()
      .from(dbSchema.planningTodos)
      .where(eq(dbSchema.planningTodos.taskId, taskId))
      .orderBy(asc(dbSchema.planningTodos.orderIndex), asc(dbSchema.planningTodos.createdAt));

    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      content: row.content,
      orderIndex: row.orderIndex,
      done: row.done === 1,
      completedAt: row.completedAt || undefined,
      completedBy: row.completedBy || undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async updatePlanningTodoAsync(todoId: string, updates: Partial<PlanningTodo>): Promise<void> {
    await this.ensureReadyAsync();
    const todoUpdates: Record<string, unknown> = {};

    if (updates.content !== undefined) {
      todoUpdates.content = updates.content;
    }
    if (updates.orderIndex !== undefined) {
      todoUpdates.orderIndex = updates.orderIndex;
    }
    if (updates.done !== undefined) {
      todoUpdates.done = updates.done ? 1 : 0;
    }
    if (updates.completedAt !== undefined) {
      todoUpdates.completedAt = updates.completedAt || null;
    }
    if (updates.completedBy !== undefined) {
      todoUpdates.completedBy = updates.completedBy || null;
    }
    if (updates.updatedAt !== undefined) {
      todoUpdates.updatedAt = updates.updatedAt;
    }

    if (Object.keys(todoUpdates).length === 0) {
      return;
    }

    await this.db()
      .update(dbSchema.planningTodos)
      .set(todoUpdates)
      .where(eq(dbSchema.planningTodos.id, todoId));
  }

  async createPlanningTaskDelegationAsync(
    delegation: PlanningTaskDelegation
  ): Promise<PlanningTaskDelegation> {
    await this.ensureReadyAsync();
    this.db()
      .insert(dbSchema.planningTaskDelegations)
      .values({
        id: delegation.id,
        taskId: delegation.taskId,
        fromAgentId: delegation.fromAgentId,
        toAgentId: delegation.toAgentId,
        reason: delegation.reason || null,
        delegatedAt: delegation.delegatedAt,
        accepted: delegation.accepted ? 1 : 0,
        acceptedAt: delegation.acceptedAt || null,
      })
      .run();

    return delegation;
  }

  async listPlanningTaskDelegationsAsync(taskId: string): Promise<PlanningTaskDelegation[]> {
    await this.ensureReadyAsync();
    const rows = await this.db()
      .select()
      .from(dbSchema.planningTaskDelegations)
      .where(eq(dbSchema.planningTaskDelegations.taskId, taskId))
      .orderBy(desc(dbSchema.planningTaskDelegations.delegatedAt));

    return rows.map((row) => ({
      id: row.id,
      taskId: row.taskId,
      fromAgentId: row.fromAgentId,
      toAgentId: row.toAgentId,
      reason: row.reason || undefined,
      delegatedAt: row.delegatedAt,
      accepted: row.accepted === 1,
      acceptedAt: row.acceptedAt || undefined,
    }));
  }
}
