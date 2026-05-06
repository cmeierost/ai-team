import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';
import { TOKENS } from '../service-bootstrap.js';

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
    const { CreateCommand } = await import('@ai-team/service/src/commands/create.js');
    const cmd = new CreateCommand(
      container.resolve(TOKENS.AgentManager),
      container.resolve(TOKENS.SkillManager)
    );
    return cmd.execute(payload.type, payload.options, context);
  }
);
