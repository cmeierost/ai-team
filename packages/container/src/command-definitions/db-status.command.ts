import path from 'node:path';
import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { TOKENS } from '../service-bootstrap.js';
import { createFactoryCommandDefinition } from './shared.js';

export const dbStatusCliMetadata: CliCommandMetadata = {
  key: 'db:status',
  command: 'db:status',
  description: 'Show database status and statistics',
  llmCallable: false,
  directCli: true,
};

export const dbStatusCommandDefinition = createFactoryCommandDefinition(
  'dbStatus',
  dbStatusCliMetadata,
  async (container) => {
    const { dbStatusCommandAsync } = await import('@ai-team/service/src/commands/db.js');
    const backend = container.resolve(TOKENS.SqliteBackend);
    const dbPath = path.join(container.workspaceRoot, '.ai-team', 'private', 'ai-team.db');
    return dbStatusCommandAsync(backend, dbPath);
  }
);
