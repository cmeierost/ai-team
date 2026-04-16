import path from 'node:path';
import type { DbStatusResponse, DbMigrateResponse } from '@ai-team/api-client';
import { createSqliteStorage } from '../storage/index.js';

export async function dbStatusCommandAsync(workspaceRoot: string): Promise<DbStatusResponse> {
  const storage = createSqliteStorage(workspaceRoot);
  try {
    await storage.migrate();
    const stats = await storage.getStats();
    return {
      schemaVersion: stats.schemaVersion ?? 0,
      totalSessions: stats.totalSessions,
      totalMessages: stats.totalMessages,
      storageSizeBytes: stats.storageSize,
      dbPath: path.join(workspaceRoot, '.ai-team', 'private', 'ai-team.db'),
    };
  } finally {
    await storage.close();
  }
}

export async function dbMigrateCommandAsync(workspaceRoot: string): Promise<DbMigrateResponse> {
  const storage = createSqliteStorage(workspaceRoot);
  try {
    const applied = await storage.migrate();
    const stats = await storage.getStats();
    return {
      applied: applied ?? 0,
      schemaVersion: stats.schemaVersion ?? 0,
    };
  } finally {
    await storage.close();
  }
}
