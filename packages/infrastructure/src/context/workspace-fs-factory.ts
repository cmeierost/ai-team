import type { IWorkspaceFs, IWorkspaceFsFactory, PermissionConfig } from '@ai-team/core';
import { WorkspaceAccessFactory } from './permission-services.js';

export class InfrastructureWorkspaceFsFactory implements IWorkspaceFsFactory {
  private readonly workspaceAccessFactory: WorkspaceAccessFactory;

  constructor(workspaceRoot: string, workspaceAccessFactory?: WorkspaceAccessFactory) {
    this.workspaceAccessFactory =
      workspaceAccessFactory ?? new WorkspaceAccessFactory(workspaceRoot);
  }

  async create(agentId: string, permissions: PermissionConfig | undefined): Promise<IWorkspaceFs> {
    return this.workspaceAccessFactory.createWorkspaceFs(agentId, permissions);
  }
}
