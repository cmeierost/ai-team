import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const accessCanCliMetadata: CliCommandMetadata = {
  key: 'access.can',
  command: 'can',
  parentKey: 'access',
  description: 'Check whether a context/agent can access a path for a right',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '--path <path>', description: 'Path to evaluate' },
    {
      flags: '--right <right>',
      description: 'Right to evaluate (read, write, create, delete, list)',
      defaultValue: 'list',
    },
    { flags: '--agent <agent>', description: 'Optional agent query override' },
    { flags: '--json', description: 'Output as JSON' },
  ],
};

export const accessCanCommandDefinition = createFactoryCommandDefinition(
  'accessCan',
  accessCanCliMetadata,
  async (container, payload) => {
    const { accessCanHandler } = await import('@ai-team/service/src/commands/access.js');
    return accessCanHandler(container.workspaceRoot, payload);
  }
);
