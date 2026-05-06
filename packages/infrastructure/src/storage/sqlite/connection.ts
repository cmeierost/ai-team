import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { sql, type SQL } from 'drizzle-orm';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as schema from './schema.js';

export type SqliteDrizzleDatabase = BetterSQLite3Database<typeof schema>;

/**
 * Promisified SQLite database wrapper
 * Wraps Drizzle + better-sqlite3 with Promise-based methods for async/await usage
 */
export class SqliteConnection {
  private db: Database.Database | null = null;
  private drizzleDb: SqliteDrizzleDatabase | null = null;
  private readonly dbPath: string;

  constructor(workspaceRoot: string, dbFileName: string = 'ai-team.db') {
    const dbDir = path.join(workspaceRoot, '.ai-team', 'private');
    this.dbPath = path.join(dbDir, dbFileName);
  }

  /**
   * Open the database connection
   * Creates the .ai-team/private directory if it doesn't exist
   * Enables WAL mode for better concurrent access
   */
  async open(): Promise<void> {
    if (this.db) {
      return; // Already open
    }

    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    await fs.mkdir(dbDir, { recursive: true });

    try {
      this.db = new Database(this.dbPath);
      this.drizzleDb = drizzle(this.db, { schema });

      // Enable WAL mode for concurrent reads/writes
      this.db.pragma('journal_mode = WAL');
      // Enable foreign keys
      this.db.pragma('foreign_keys = ON');
    } catch (error) {
      this.db = null;
      this.drizzleDb = null;
      throw new Error(
        `Failed to open database at ${this.dbPath}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      this.db.close();
    } catch (error) {
      throw new Error(
        `Failed to close database: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      this.db = null;
      this.drizzleDb = null;
    }
  }

  private ensureDrizzleDb(): SqliteDrizzleDatabase {
    if (!this.db || !this.drizzleDb) {
      throw new Error('Database not open. Call open() first.');
    }
    return this.drizzleDb;
  }

  getDrizzleDb(): SqliteDrizzleDatabase {
    return this.ensureDrizzleDb();
  }

  private toParameterizedSql(sqlText: string, params: any[] = []): SQL {
    if (params.length === 0) {
      return sql.raw(sqlText);
    }

    const parts = sqlText.split('?');
    if (parts.length !== params.length + 1) {
      throw new Error(
        `SQL parameter mismatch: expected ${parts.length - 1} parameter(s) but received ${params.length}. SQL: ${sqlText}`
      );
    }

    const chunks: SQL[] = [];
    for (let i = 0; i < parts.length; i++) {
      chunks.push(sql.raw(parts[i] || ''));
      if (i < params.length) {
        chunks.push(sql`${params[i]}`);
      }
    }

    return sql.join(chunks, sql.raw(''));
  }

  /**
   * Execute a SQL query that doesn't return rows (INSERT, UPDATE, DELETE, CREATE, etc.)
   * @returns Object with lastID and changes count
   */
  async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    const db = this.ensureDrizzleDb();

    try {
      const result = db.run(this.toParameterizedSql(sql, params)) as {
        changes?: number;
        lastInsertRowid?: number | bigint;
      };

      const rawLastInsertRowid = result.lastInsertRowid;
      let lastID = 0;
      if (rawLastInsertRowid !== undefined) {
        lastID =
          typeof rawLastInsertRowid === 'bigint' ? Number(rawLastInsertRowid) : rawLastInsertRowid;
      }

      return {
        lastID,
        changes: result.changes ?? 0,
      };
    } catch (error) {
      throw new Error(
        `SQL run error: ${error instanceof Error ? error.message : String(error)}\nSQL: ${sql}`
      );
    }
  }

  /**
   * Execute a SQL query that returns a single row
   * @returns The first row or null if no results
   */
  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const db = this.ensureDrizzleDb();

    try {
      const row = db.get(this.toParameterizedSql(sql, params)) as T | undefined;
      return row ?? null;
    } catch (error) {
      throw new Error(
        `SQL get error: ${error instanceof Error ? error.message : String(error)}\nSQL: ${sql}`
      );
    }
  }

  /**
   * Execute a SQL query that returns multiple rows
   * @returns Array of rows (empty array if no results)
   */
  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const db = this.ensureDrizzleDb();

    try {
      return (db.all(this.toParameterizedSql(sql, params)) as T[]) || [];
    } catch (error) {
      throw new Error(
        `SQL all error: ${error instanceof Error ? error.message : String(error)}\nSQL: ${sql}`
      );
    }
  }

  /**
   * Execute multiple SQL statements in one string (convenience method for migrations)
   * Cannot use parameterized queries. Use transaction() method if you need parameters.
   */
  async exec(sql: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not open. Call open() first.');
    }

    try {
      this.db.exec(sql);
    } catch (error) {
      throw new Error(`SQL exec error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Serialization lock — ensures no two transactions are open at the same time.
   * Concurrent callers chain off the tail of this promise so they wait their turn.
   */
  private _txLock: Promise<void> = Promise.resolve();

  /**
   * Execute a callback inside a serialized BEGIN / COMMIT / ROLLBACK block.
   * The callback receives a `run` helper that executes SQL and returns
   * { lastID, changes } — identical to the top-level `run()`.
   *
   * Only one transaction is active at a time; concurrent callers are queued.
   */
  async runTransaction<T>(
    callback: (
      run: (sql: string, params?: any[]) => Promise<{ lastID: number; changes: number }>
    ) => Promise<T>
  ): Promise<T> {
    let resolve!: () => void;
    // The next caller will wait until this promise settles.
    const lockPromise = new Promise<void>((res) => {
      resolve = res;
    });

    const prev = this._txLock;
    this._txLock = lockPromise;

    await prev; // Wait for any in-flight transaction to finish.

    if (!this.db) {
      resolve();
      throw new Error('Database not open. Call open() first.');
    }

    await this.run('BEGIN TRANSACTION');
    try {
      const result = await callback(this.run.bind(this));
      await this.run('COMMIT');
      resolve();
      return result;
    } catch (error) {
      try {
        await this.run('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      resolve(); // Release lock even on failure so subsequent callers can proceed.
      throw error;
    }
  }

  /**
   * Execute multiple SQL statements in a transaction.
   * If any statement fails, the entire transaction is rolled back.
   * Returns per-statement { lastID, changes } results.
   * Concurrent calls are serialized — no "cannot start a transaction
   * within a transaction" errors.
   */
  async transaction(
    statements: Array<{ sql: string; params?: any[] }>
  ): Promise<Array<{ lastID: number; changes: number }>> {
    return this.runTransaction(async (run) => {
      const results: Array<{ lastID: number; changes: number }> = [];
      for (const stmt of statements) {
        results.push(await run(stmt.sql, stmt.params || []));
      }
      return results;
    });
  }

  /**
   * Get the database file path
   */
  getPath(): string {
    return this.dbPath;
  }

  /**
   * Check if database file exists
   */
  async exists(): Promise<boolean> {
    try {
      await fs.access(this.dbPath);
      return true;
    } catch {
      return false;
    }
  }
}
