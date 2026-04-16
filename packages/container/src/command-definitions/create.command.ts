import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const createCliMetadata: CliCommandMetadata = {
  key: 'create',
  command: 'create <type>',
  description: 'Create a new entity (agent or skill)',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '-n, --name <name>', description: 'Employee name' },
    { flags: '-r, --role <role>', description: 'Employee role' },
    { flags: '--interactive', description: 'Interactive mode' },
  ],
};

export const createCommandDefinition = createFactoryCommandDefinition(
  'create',
  createCliMetadata,
  async (container, payload, context) => {
    const { createCommand } = await import('@ai-team/service/src/commands/create.js');
    return createCommand(container.workspaceRoot, payload.type, payload.options, context);
  }
);
