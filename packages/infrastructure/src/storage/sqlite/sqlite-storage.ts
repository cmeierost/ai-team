import type { StorageStats, IMessageStorage } from '@ai-team/core';
import { sql } from 'drizzle-orm';
import { SqliteConnection } from './connection.js';
import { MigrationManager } from './migrations.js';
import type { SqliteDrizzleDatabase } from './connection.js';
import * as dbSchema from './schema.js';
import * as fs from 'node:fs/promises';

/**
 * Lifecycle and stats for the SQLite backend.
 * Repos are wired externally (container or test setup) using the
 * ensureReadyAsync / getDb callbacks this backend exposes.
 */
export class SqliteBackend implements IMessageStorage {
  private readonly connection: SqliteConnection;
  private readonly migrations: MigrationManager;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  constructor(workspaceRoot: string) {
    this.connection = new SqliteConnection(workspaceRoot);
    this.migrations = new MigrationManager(this.connection);
  }

  /** Lazy-init callback to pass into repositories. */
  readonly ensureReadyAsync = (): Promise<void> => {
    if (this.ready) return Promise.resolve();
    this.initPromise ??= (async () => {
      await this.connection.open();
      await this.migrations.initialize();
      this.ready = true;
    })();
    return this.initPromise;
  };

  /** Db accessor callback to pass into repositories. */
  readonly getDb = (): SqliteDrizzleDatabase => {
    return this.connection.getDrizzleDb();
  };

  async migrate(): Promise<number> {
    await this.ensureReadyAsync();
    return this.migrations.migrate();
  }

  async resetAndInitializeAsync(): Promise<number> {
    await this.ensureReadyAsync();
    return this.migrations.resetAndInitializeAsync();
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  async getStats(): Promise<StorageStats> {
    await this.ensureReadyAsync();
    const sessionCount = this.connection
      .getDrizzleDb()
      .select({ count: sql<number>`count(*)` })
      .from(dbSchema.sessions)
      .get();
    const messageCount = this.connection
      .getDrizzleDb()
      .select({ count: sql<number>`count(*)` })
      .from(dbSchema.messages)
      .get();
    const version = await this.migrations.getCurrentVersion();
    let storageSize: number | undefined;
    try {
      const stat = await fs.stat(this.connection.getPath());
      storageSize = stat.size;
    } catch {
      storageSize = undefined;
    }
    return {
      totalSessions: sessionCount?.count || 0,
      totalMessages: messageCount?.count || 0,
      storageSize,
      schemaVersion: version,
    };
  }
}
