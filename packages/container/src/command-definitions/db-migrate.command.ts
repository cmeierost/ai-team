import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { TOKENS } from '../service-bootstrap.js';
import { createFactoryCommandDefinition } from './shared.js';

export const dbMigrateCliMetadata: CliCommandMetadata = {
  key: 'db:migrate',
  command: 'db:migrate',
  description: 'Reset and initialize database schema (alpha)',
  llmCallable: false,
  directCli: true,
};

export const dbMigrateCommandDefinition = createFactoryCommandDefinition(
  'dbMigrate',
  dbMigrateCliMetadata,
  async (container) => {
    const { dbMigrateCommandAsync } = await import('@ai-team/service/src/commands/db.js');
    const backend = container.resolve(TOKENS.SqliteBackend);
    return dbMigrateCommandAsync(backend);
  }
);
