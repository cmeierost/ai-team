import { Command } from 'commander';
import path from 'path';
import { createSqliteStorage } from '@ai-team/service';

/**
 * Database status command
 * Shows current schema version, storage size, and record counts
 */
export function dbStatusCommand(workspaceRoot: string): Command {
  const cmd = new Command('db:status');
  cmd.description('Show database status and statistics');
  
  cmd.action(async () => {
    try {
      const storage = createSqliteStorage(workspaceRoot);
      await storage.initialize();
      
      const stats = await storage.getStats();
      
      console.log('\nDatabase Status:');
      console.log('================');
      console.log(`Schema Version: v${stats.schemaVersion}`);
      console.log(`Total Sessions: ${stats.totalSessions}`);
      console.log(`Total Messages: ${stats.totalMessages}`);
      
      if (stats.storageSize !== undefined) {
        const sizeKB = (stats.storageSize / 1024).toFixed(2);
        const sizeMB = (stats.storageSize / (1024 * 1024)).toFixed(2);
        console.log(`Storage Size:   ${sizeKB} KB (${sizeMB} MB)`);
      }
      
      const dbPath = path.join(workspaceRoot, '.ai-team', 'private', 'ai-team.db');
      console.log(`Database Path:  ${dbPath}`);
      console.log();
      
      await storage.close();
    } catch (error) {
      console.error('Error getting database status:', error);
      process.exit(1);
    }
  });
  
  return cmd;
}

/**
 * Database migration command
 * Applies any pending schema migrations
 * Note: Migrations are also applied automatically on initialization
 */
export function dbMigrateCommand(workspaceRoot: string): Command {
  const cmd = new Command('db:migrate');
  cmd.description('Apply pending database migrations');
  
  cmd.action(async () => {
    try {
      const storage = createSqliteStorage(workspaceRoot);
      
      console.log('Checking for pending migrations...');
      await storage.initialize();
      
      console.log('✓ Database is up to date');
      
      const stats = await storage.getStats();
      console.log(`Current schema version: v${stats.schemaVersion}`);
      
      await storage.close();
    } catch (error) {
      console.error('Error applying migrations:', error);
      process.exit(1);
    }
  });
  
  return cmd;
}
