import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const dbMigrateCliMetadata: CliCommandMetadata = {
  key: 'db:migrate',
  command: 'db:migrate',
  description: 'Apply pending database migrations',
  llmCallable: false,
  directCli: true,
};

export const dbMigrateCommandDefinition = createFactoryCommandDefinition(
  'dbMigrate',
  dbMigrateCliMetadata,
  async (container) => {
    const { dbMigrateCommandAsync } = await import('@ai-team/service/src/commands/db.js');
    return dbMigrateCommandAsync(container.workspaceRoot);
  }
);
