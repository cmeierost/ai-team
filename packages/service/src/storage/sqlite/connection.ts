import sqlite3 from 'sqlite3';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

/**
 * Promisified SQLite database wrapper
 * Wraps the callback-based sqlite3 API with Promises for async/await usage
 */
export class SqliteConnection {
  private db: sqlite3.Database | null = null;
  private dbPath: string;

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

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(new Error(`Failed to open database at ${this.dbPath}: ${err.message}`));
          return;
        }

        // Enable WAL mode for concurrent reads/writes
        this.db!.run('PRAGMA journal_mode = WAL;', (walErr) => {
          if (walErr) {
            reject(new Error(`Failed to enable WAL mode: ${walErr.message}`));
            return;
          }

          // Enable foreign keys
          this.db!.run('PRAGMA foreign_keys = ON;', (fkErr) => {
            if (fkErr) {
              reject(new Error(`Failed to enable foreign keys: ${fkErr.message}`));
              return;
            }
            resolve();
          });
        });
      });
    });
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (!this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.db!.close((err) => {
        this.db = null;
        if (err) {
          reject(new Error(`Failed to close database: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Execute a SQL query that doesn't return rows (INSERT, UPDATE, DELETE, CREATE, etc.)
   * @returns Object with lastID and changes count
   */
  async run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
    if (!this.db) {
      throw new Error('Database not open. Call open() first.');
    }

    return new Promise((resolve, reject) => {
      this.db!.run(sql, params, function (err) {
        if (err) {
          reject(new Error(`SQL run error: ${err.message}\nSQL: ${sql}`));
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  /**
   * Execute a SQL query that returns a single row
   * @returns The first row or null if no results
   */
  async get<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    if (!this.db) {
      throw new Error('Database not open. Call open() first.');
    }

    return new Promise((resolve, reject) => {
      this.db!.get(sql, params, (err, row) => {
        if (err) {
          reject(new Error(`SQL get error: ${err.message}\nSQL: ${sql}`));
        } else {
          resolve((row as T) || null);
        }
      });
    });
  }

  /**
   * Execute a SQL query that returns multiple rows
   * @returns Array of rows (empty array if no results)
   */
  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    if (!this.db) {
      throw new Error('Database not open. Call open() first.');
    }

    return new Promise((resolve, reject) => {
      this.db!.all(sql, params, (err, rows) => {
        if (err) {
          reject(new Error(`SQL all error: ${err.message}\nSQL: ${sql}`));
        } else {
          resolve((rows as T[]) || []);
        }
      });
    });
  }

  /**
   * Execute multiple SQL statements in one string (convenience method for migrations)
   * Cannot use parameterized queries. Use transaction() method if you need parameters.
   */
  async exec(sql: string): Promise<void> {
    if (!this.db) {
      throw new Error('Database not open. Call open() first.');
    }

    return new Promise((resolve, reject) => {
      this.db!.exec(sql, (err) => {
        if (err) {
          reject(new Error(`SQL exec error: ${err.message}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Execute multiple SQL statements in a transaction
   * If any statement fails, the entire transaction is rolled back
   */
  async transaction(statements: Array<{ sql: string; params?: any[] }>): Promise<void> {
    if (!this.db) {
      throw new Error('Database not open. Call open() first.');
    }

    await this.run('BEGIN TRANSACTION');

    try {
      for (const stmt of statements) {
        await this.run(stmt.sql, stmt.params || []);
      }
      await this.run('COMMIT');
    } catch (error) {
      await this.run('ROLLBACK');
      throw error;
    }
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
