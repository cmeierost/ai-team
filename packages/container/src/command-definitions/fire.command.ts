import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const fireCliMetadata: CliCommandMetadata = {
  key: 'fire',
  command: 'fire <agent>',
  description: 'Fire (delete) an employee and remove their data',
  llmCallable: true,
  directCli: true,
  options: [{ flags: '-f, --force', description: 'Do not prompt for confirmation' }],
};

export const fireCommandDefinition = createFactoryCommandDefinition(
  'fire',
  fireCliMetadata,
  async (container, payload, context) => {
    const { fireCommand } = await import('@ai-team/service/src/commands/fire.js');
    return fireCommand(container.workspaceRoot, payload.employeeQuery, payload.options, context);
  }
);
