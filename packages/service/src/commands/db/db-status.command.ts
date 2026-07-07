import path from 'node:path';
import type {
  ICommand,
  IMessageStorage,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { DbStatusResponse } from '@ai-team/api-contracts';
export const DbStatusCommandMetadata = {
  key: 'status',
  description: 'Show database status and statistics',
  availableIn: { cli: true },
  group: 'db',
} satisfies ICommandDescriptor;

export class DbStatusCommand implements ICommand<Record<string, never>, DbStatusResponse> {
  readonly metadata = DbStatusCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly storage: IMessageStorage
  ) {}

  async execute(
    _payload: Record<string, never>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<DbStatusResponse>> {
    const dbPath = path.join(this.workspaceRoot, '.ai-team', 'private', 'ai-team.db');
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
