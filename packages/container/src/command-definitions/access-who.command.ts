import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';
import { TOKENS } from '../service-bootstrap.js';

export const accessWhoCliMetadata: CliCommandMetadata = {
  key: 'access.who',
  command: 'who',
  parentKey: 'access',
  description: 'Show which contexts/agents can access a path for a right',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '--path <path>', description: 'Path to evaluate' },
    {
      flags: '--right <right>',
      description: 'Right to evaluate (read, write, create, delete, list)',
      defaultValue: 'list',
    },
    { flags: '--json', description: 'Output as JSON' },
  ],
};

export const accessWhoCommandDefinition = createFactoryCommandDefinition(
  'accessWho',
  accessWhoCliMetadata,
  async (container, payload) => {
    const { whoHasAccessCommand } = await import('@ai-team/service/src/commands/access.js');
    return whoHasAccessCommand(
      container.workspaceRoot,
      container.resolve(TOKENS.AgentManager),
      container.resolve(TOKENS.PathPermissionChecker),
      payload
    );
  }
);
