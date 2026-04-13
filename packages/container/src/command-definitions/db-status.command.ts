import type { CliCommandMetadata } from '@ai-team/infrastructure';
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
    return dbStatusCommandAsync(container.workspaceRoot);
  }
);
