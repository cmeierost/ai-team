import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { SqliteConnection } from './connection.js';

/**
 * Alpha migration policy:
 * - Runtime migration execution is handled by Drizzle migrator against SQL files in `drizzle/migrations`
 * - Keep a single baseline schema version (v1)
 * - Automatically reset legacy schemas/data from earlier alpha iterations
 * - Preserve this manager as the seam where post-alpha versioned migrations
 *   can be expanded safely.
 */

export interface Migration {
  version: number;
  name: string;
  fileName: string;
}

const ALPHA_BASELINE_SCHEMA_VERSION = 1;
const DRIZZLE_MIGRATIONS_RELATIVE_FOLDER = path.join('drizzle', 'migrations');

export const MIGRATIONS: Migration[] = [
  {
    version: ALPHA_BASELINE_SCHEMA_VERSION,
    name: 'initial_alpha_baseline_schema',
    fileName: '0000_initial_alpha_baseline.sql',
  },
];

type SqliteSchemaObjectType = 'table' | 'index' | 'trigger' | 'view';

export class MigrationManager {
  constructor(private readonly db: SqliteConnection) {}

  private initialized = false;

  async getCurrentVersion(): Promise<number> {
    try {
      const row = await this.db.get<{ version: number }>(
        'SELECT MAX(version) as version FROM schema_version'
      );
      return row?.version || 0;
    } catch {
      return 0;
    }
  }

  getTargetVersion(): number {
    return ALPHA_BASELINE_SCHEMA_VERSION;
  }

  async needsMigration(): Promise<boolean> {
    const current = await this.getCurrentVersion();
    return current < this.getTargetVersion();
  }

  async getPendingMigrations(): Promise<Migration[]> {
    const currentVersion = await this.getCurrentVersion();
    return MIGRATIONS.filter((migration) => migration.version > currentVersion);
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
  }

  private async listSchemaObjectsAsync(): Promise<
    Array<{ type: SqliteSchemaObjectType; name: string }>
  > {
    return this.db.all<{ type: SqliteSchemaObjectType; name: string }>(
      `SELECT type, name
         FROM sqlite_master
        WHERE type IN ('table', 'index', 'trigger', 'view')
          AND name NOT LIKE 'sqlite_%'`
    );
  }

  private async hasUserSchemaObjectsAsync(): Promise<boolean> {
    const row = await this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count
         FROM sqlite_master
        WHERE type IN ('table', 'index', 'trigger', 'view')
          AND name NOT LIKE 'sqlite_%'`
    );

    return (row?.count ?? 0) > 0;
  }

  async resetSchemaAsync(): Promise<void> {
    const objects = await this.listSchemaObjectsAsync();
    const dropOrder: SqliteSchemaObjectType[] = ['trigger', 'view', 'index', 'table'];

    await this.db.run('PRAGMA foreign_keys = OFF');
    try {
      for (const type of dropOrder) {
        const typeObjects = objects.filter((object) => object.type === type);
        for (const object of typeObjects) {
          await this.db.exec(
            `DROP ${type.toUpperCase()} IF EXISTS ${this.quoteIdentifier(object.name)};`
          );
        }
      }
    } finally {
      await this.db.run('PRAGMA foreign_keys = ON');
    }
  }

  private getWorkspaceRootFromDbPath(): string {
    const dbPath = this.db.getPath();
    return path.resolve(dbPath, '..', '..', '..');
  }

  private getPackageRootFromModulePath(): string {
    const currentFilePath = fileURLToPath(import.meta.url);
    const currentDir = path.dirname(currentFilePath);
    return path.resolve(currentDir, '..', '..', '..');
  }

  private getDrizzleMigrationsFolderCandidates(): string[] {
    const workspaceCandidate = path.join(
      this.getWorkspaceRootFromDbPath(),
      DRIZZLE_MIGRATIONS_RELATIVE_FOLDER
    );

    const packageCandidate = path.join(
      this.getPackageRootFromModulePath(),
      DRIZZLE_MIGRATIONS_RELATIVE_FOLDER
    );

    return Array.from(new Set([workspaceCandidate, packageCandidate]));
  }

  private async resolveDrizzleMigrationsFolderPathAsync(): Promise<string> {
    const candidates = this.getDrizzleMigrationsFolderCandidates();

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // Try next candidate.
      }
    }

    throw new Error(
      `Drizzle migrations folder not found. Checked: ${candidates.join(', ')}. Ensure drizzle-kit migrations are present before runtime initialization.`
    );
  }

  private async getAppliedDrizzleMigrationsCountAsync(): Promise<number> {
    try {
      const row = await this.db.get<{ count: number }>(
        'SELECT COUNT(*) as count FROM __drizzle_migrations'
      );
      return row?.count ?? 0;
    } catch {
      return 0;
    }
  }

  private async runDrizzleMigrationsAsync(): Promise<number> {
    const migrationsFolder = await this.resolveDrizzleMigrationsFolderPathAsync();

    const beforeCount = await this.getAppliedDrizzleMigrationsCountAsync();

    drizzleMigrate(this.db.getDrizzleDb(), {
      migrationsFolder,
    });

    const afterCount = await this.getAppliedDrizzleMigrationsCountAsync();
    return Math.max(0, afterCount - beforeCount);
  }

  private async resetIfLegacySchemaDetectedAsync(): Promise<void> {
    const currentVersion = await this.getCurrentVersion();
    const targetVersion = this.getTargetVersion();

    if (currentVersion > targetVersion) {
      await this.resetSchemaAsync();
      return;
    }

    if (currentVersion === 0) {
      const hasUserSchemaObjects = await this.hasUserSchemaObjectsAsync();
      if (hasUserSchemaObjects) {
        await this.resetSchemaAsync();
      }
    }
  }

  async migrate(): Promise<number> {
    await this.resetIfLegacySchemaDetectedAsync();
    return this.runDrizzleMigrationsAsync();
  }

  async resetAndInitializeAsync(): Promise<number> {
    await this.resetSchemaAsync();
    this.initialized = false;
    return this.migrate();
  }

  async initialize(): Promise<number> {
    if (this.initialized) {
      return 0;
    }

    const applied = await this.migrate();
    this.initialized = true;
    return applied;
  }
}
