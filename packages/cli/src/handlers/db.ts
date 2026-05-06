/**
 * Database commands - pure CLI renderers
 */

import chalk from 'chalk';
import type { DbStatusResponse, DbMigrateResponse } from '@ai-team/api-contracts';

export function renderDbStatus(data: DbStatusResponse): void {
  console.log('\nDatabase Status:');
  console.log('================');
  console.log(`Schema Version: v${data.schemaVersion}`);
  console.log(`Total Sessions: ${data.totalSessions}`);
  console.log(`Total Messages: ${data.totalMessages}`);

  if (data.storageSizeBytes !== undefined) {
    const sizeKB = (data.storageSizeBytes / 1024).toFixed(2);
    const sizeMB = (data.storageSizeBytes / (1024 * 1024)).toFixed(2);
    console.log(`Storage Size:   ${sizeKB} KB (${sizeMB} MB)`);
  }

  console.log(`Database Path:  ${data.dbPath}`);
  console.log();
}

export function renderDbMigrate(data: DbMigrateResponse): void {
  if (data.applied > 0) {
    console.log(chalk.green('✓ Database reset and baseline schema initialized'));
  } else {
    console.log(chalk.green('✓ Database baseline schema already initialized'));
  }
  console.log(`Current schema version: v${data.schemaVersion}`);
}
