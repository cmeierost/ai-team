import type { ITasksService } from '@ai-team/api-contracts';
import type { IAgentManager } from '@ai-team/core';
import { TaskManager } from '../task-manager.js';
import { NotFoundError } from '../http-errors.js';

export class TasksService implements ITasksService {
  private readonly taskManager: TaskManager;

  constructor(workspaceRoot: string, agentManager: IAgentManager) {
    this.taskManager = new TaskManager(workspaceRoot, agentManager);
  }

  async dashboard(): Promise<unknown> {
    return this.taskManager.getStatistics();
  }

  async templates(): Promise<unknown[]> {
    return this.taskManager.getTemplates();
  }

  async createFromTemplate(body: {
    templateId: string;
    overrides?: Record<string, unknown>;
  }): Promise<unknown> {
    const task = await this.taskManager.createFromTemplate(body.templateId, body.overrides as any);
    if (!task) throw new NotFoundError('Template not found');
    return task;
  }

  async list(query?: {
    status?: string | string[];
    priority?: string | string[];
    assignedTo?: string;
    createdBy?: string;
    type?: string | string[];
    tags?: string | string[];
    parentTaskId?: string;
  }): Promise<unknown[]> {
    const filter: Record<string, unknown> = {};
    if (query?.status) filter.status = query.status;
    if (query?.priority) filter.priority = query.priority;
    if (query?.assignedTo) filter.assignedTo = query.assignedTo;
    if (query?.createdBy) filter.createdBy = query.createdBy;
    if (query?.type) filter.type = query.type;
    if (query?.tags) filter.tags = Array.isArray(query.tags) ? query.tags : [query.tags];
    if (query?.parentTaskId !== undefined)
      filter.parentTaskId = query.parentTaskId === 'null' ? undefined : query.parentTaskId;
    return this.taskManager.listTasks(filter as any);
  }

  async create(body: Record<string, unknown>): Promise<unknown> {
    return this.taskManager.createTask(body as any);
  }

  async getById(taskId: string): Promise<unknown> {
    const task = await this.taskManager.getTask(taskId);
    if (!task) throw new NotFoundError('Task not found');
    return task;
  }

  async getHierarchy(taskId: string): Promise<unknown> {
    return this.taskManager.getTaskHierarchy(taskId);
  }

  async update(taskId: string, body: Record<string, unknown>): Promise<unknown> {
    const task = await this.taskManager.updateTask(taskId, body as any);
    if (!task) throw new NotFoundError('Task not found');
    return task;
  }
}
