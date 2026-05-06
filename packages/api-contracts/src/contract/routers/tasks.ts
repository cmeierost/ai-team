import type { ApiDescription } from '@ts-http/core';

export interface ITasksService {
  dashboard(): Promise<unknown>;
  templates(): Promise<unknown[]>;
  createFromTemplate(body: {
    templateId: string;
    overrides?: Record<string, unknown>;
  }): Promise<unknown>;
  list(query?: {
    status?: string | string[];
    priority?: string | string[];
    assignedTo?: string;
    createdBy?: string;
    type?: string | string[];
    tags?: string | string[];
    parentTaskId?: string;
  }): Promise<unknown[]>;
  create(body: Record<string, unknown>): Promise<unknown>;
  getById(taskId: string): Promise<unknown>;
  getHierarchy(taskId: string): Promise<unknown>;
  /** PUT (was PATCH) */
  update(taskId: string, body: Record<string, unknown>): Promise<unknown>;
}

export const tasksDesc: ApiDescription<ITasksService> = {
  subRoute: '/api/tasks',
  mapping: {
    dashboard: { method: 'GET', path: 'dashboard' },
    templates: { method: 'GET', path: 'templates' },
    createFromTemplate: { method: 'POST', path: 'from-template' },
    list: { method: 'GET', path: '' },
    create: { method: 'POST', path: '' },
    getById: { method: 'GET', path: ':taskId' },
    getHierarchy: { method: 'GET', path: ':taskId/hierarchy' },
    update: { method: 'PUT', path: ':taskId' },
  },
};
