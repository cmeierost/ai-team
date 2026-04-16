import { describe, expect, it, vi } from 'vitest';
import { PlanningService } from './planning-service.js';
import { PlanStatus, TaskPriority, TaskType } from '@ai-team/core';

describe('PlanningService', () => {
  it('creates plan with defaults', async () => {
    const createPlanningPlanAsync = vi.fn(async (plan) => plan);
    const storage = {
      listPlanningPlansAsync: vi.fn(async () => []),
      createPlanningPlanAsync,
      getPlanningPlanAsync: vi.fn(async () => null),
      updatePlanningPlanAsync: vi.fn(async () => undefined),
      getPlanningPlanSessionVisibilityAsync: vi.fn(async () => null),
      listPlanningIntakeItemsAsync: vi.fn(async () => []),
      upsertPlanningIntakeItemAsync: vi.fn(async () => undefined),
      createPlanningTaskAsync: vi.fn(async (task) => task),
      getPlanningTaskAsync: vi.fn(async () => null),
      listPlanningTasksAsync: vi.fn(async () => []),
      updatePlanningTaskAsync: vi.fn(async () => undefined),
      createPlanningTodoAsync: vi.fn(async (todo) => todo),
      listPlanningTodosAsync: vi.fn(async () => []),
      updatePlanningTodoAsync: vi.fn(async () => undefined),
      createPlanningTaskDelegationAsync: vi.fn(async (delegation) => delegation),
      listPlanningTaskDelegationsAsync: vi.fn(async () => []),
    } as any;

    const service = new PlanningService(storage);
    const created = await service.createPlan({ title: 'Ship planning API' });

    expect(created.title).toBe('Ship planning API');
    expect(created.status).toBe(PlanStatus.DRAFT);
    expect(created.priority).toBe(TaskPriority.MEDIUM);
    expect(created.createdBy).toBe('developer');
    expect(created.createdByType).toBe('human');
    expect(createPlanningPlanAsync).toHaveBeenCalledOnce();
  });

  it('throws not found when plan does not exist', async () => {
    const storage = {
      getPlanningPlanAsync: vi.fn(async () => null),
      listPlanningPlansAsync: vi.fn(async () => []),
      createPlanningPlanAsync: vi.fn(async (plan) => plan),
      updatePlanningPlanAsync: vi.fn(async () => undefined),
      getPlanningPlanSessionVisibilityAsync: vi.fn(async () => null),
      listPlanningIntakeItemsAsync: vi.fn(async () => []),
      upsertPlanningIntakeItemAsync: vi.fn(async () => undefined),
      createPlanningTaskAsync: vi.fn(async (task) => task),
      getPlanningTaskAsync: vi.fn(async () => null),
      listPlanningTasksAsync: vi.fn(async () => []),
      updatePlanningTaskAsync: vi.fn(async () => undefined),
      createPlanningTodoAsync: vi.fn(async (todo) => todo),
      listPlanningTodosAsync: vi.fn(async () => []),
      updatePlanningTodoAsync: vi.fn(async () => undefined),
      createPlanningTaskDelegationAsync: vi.fn(async (delegation) => delegation),
      listPlanningTaskDelegationsAsync: vi.fn(async () => []),
    } as any;

    const service = new PlanningService(storage);

    await expect(service.getPlan('missing')).rejects.toThrow('Plan not found');
  });

  it('creates task only when plan exists', async () => {
    const storage = {
      getPlanningPlanAsync: vi.fn(async (planId: string) =>
        planId === 'plan-1'
          ? {
              id: 'plan-1',
              title: 'P1',
              status: PlanStatus.ACTIVE,
              priority: TaskPriority.HIGH,
              createdBy: 'developer',
              createdByType: 'human',
              originType: 'session_discussion',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : null
      ),
      createPlanningTaskAsync: vi.fn(async (task) => task),
      getPlanningTaskAsync: vi.fn(async () => null),
      listPlanningTasksAsync: vi.fn(async () => []),
      updatePlanningTaskAsync: vi.fn(async () => undefined),
      listPlanningPlansAsync: vi.fn(async () => []),
      createPlanningPlanAsync: vi.fn(async (plan) => plan),
      updatePlanningPlanAsync: vi.fn(async () => undefined),
      getPlanningPlanSessionVisibilityAsync: vi.fn(async () => null),
      listPlanningIntakeItemsAsync: vi.fn(async () => []),
      upsertPlanningIntakeItemAsync: vi.fn(async () => undefined),
      createPlanningTodoAsync: vi.fn(async (todo) => todo),
      listPlanningTodosAsync: vi.fn(async () => []),
      updatePlanningTodoAsync: vi.fn(async () => undefined),
      createPlanningTaskDelegationAsync: vi.fn(async (delegation) => delegation),
      listPlanningTaskDelegationsAsync: vi.fn(async () => []),
    } as any;

    const service = new PlanningService(storage);
    const created = await service.createTask({
      planId: 'plan-1',
      sessionId: 'session-1',
      title: 'Implement task API',
      type: TaskType.FEATURE,
    });

    expect(created.planId).toBe('plan-1');
    expect(created.sessionId).toBe('session-1');
    expect(created.status).toBe('not_started');
    expect(created.priority).toBe('medium');

    await expect(
      service.createTask({
        planId: 'missing-plan',
        sessionId: 'session-1',
        title: 'Should fail',
      })
    ).rejects.toThrow('Plan not found');
  });

  it('returns empty visibility when plan has no linked tasks', async () => {
    const storage = {
      getPlanningPlanAsync: vi.fn(async () => ({
        id: 'plan-2',
        title: 'P2',
        status: PlanStatus.DRAFT,
        priority: TaskPriority.LOW,
        createdBy: 'developer',
        createdByType: 'human',
        originType: 'session_discussion',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })),
      getPlanningPlanSessionVisibilityAsync: vi.fn(async () => null),
      listPlanningPlansAsync: vi.fn(async () => []),
      createPlanningPlanAsync: vi.fn(async (plan) => plan),
      updatePlanningPlanAsync: vi.fn(async () => undefined),
      listPlanningIntakeItemsAsync: vi.fn(async () => []),
      upsertPlanningIntakeItemAsync: vi.fn(async () => undefined),
      createPlanningTaskAsync: vi.fn(async (task) => task),
      getPlanningTaskAsync: vi.fn(async () => null),
      listPlanningTasksAsync: vi.fn(async () => []),
      updatePlanningTaskAsync: vi.fn(async () => undefined),
      createPlanningTodoAsync: vi.fn(async (todo) => todo),
      listPlanningTodosAsync: vi.fn(async () => []),
      updatePlanningTodoAsync: vi.fn(async () => undefined),
      createPlanningTaskDelegationAsync: vi.fn(async (delegation) => delegation),
      listPlanningTaskDelegationsAsync: vi.fn(async () => []),
    } as any;

    const service = new PlanningService(storage);
    const visibility = await service.getPlanSessions('plan-2');

    expect(visibility).toEqual({ planId: 'plan-2', sessionIds: [] });
  });
});
