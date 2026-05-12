import path from 'node:path';
import type { ICommand, IMessageStorage, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { DbStatusResponse } from '@ai-team/api-contracts';

export class DbStatusCommand implements ICommand<Record<string, never>, DbStatusResponse> {
  readonly key = 'dbStatus';
  readonly cli = { command: 'db:status' };
  readonly description = 'Show database status and statistics';
  readonly availableIn = { cli: true };
  readonly group = 'db';

  constructor(private readonly storage: IMessageStorage) {}

  async execute(
    _payload: Record<string, never>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<DbStatusResponse>> {
    const dbPath = path.join(ctx.workspaceRoot, '.ai-team', 'private', 'ai-team.db');
    const stats = await this.storage.getStats();
    return {
      status: 'ok',
      message: 'Database status retrieved successfully.',
      data: {
        schemaVersion: stats.schemaVersion ?? 0,
        totalSessions: stats.totalSessions,
        totalMessages: stats.totalMessages,
        storageSizeBytes: stats.storageSize,
        dbPath,
      },
    };
  }
}
