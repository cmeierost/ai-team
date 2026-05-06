import path from 'node:path';
import type { DbStatusResponse, DbMigrateResponse } from '@ai-team/api-contracts';
import type { IMessageStorage } from '@ai-team/core';

export async function dbStatusCommandAsync(
  storage: IMessageStorage,
  dbPath: string
): Promise<DbStatusResponse> {
  const stats = await storage.getStats();
  return {
    schemaVersion: stats.schemaVersion ?? 0,
    totalSessions: stats.totalSessions,
    totalMessages: stats.totalMessages,
    storageSizeBytes: stats.storageSize,
    dbPath,
  };
}

export async function dbMigrateCommandAsync(storage: IMessageStorage): Promise<DbMigrateResponse> {
  const applied = await storage.resetAndInitializeAsync();
  const stats = await storage.getStats();
  return {
    applied: applied ?? 0,
    schemaVersion: stats.schemaVersion ?? 0,
  };
}
