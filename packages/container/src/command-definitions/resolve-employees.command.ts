import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const resolveEmployeesCliMetadata: CliCommandMetadata = {
  key: 'info',
  command: 'info <agent>',
  description: 'Show detailed information about an employee',
  llmCallable: true,
  directCli: true,
  options: [{ flags: '--json', description: 'Output as JSON' }],
};

export const resolveEmployeesCommandDefinition = createFactoryCommandDefinition(
  'resolveEmployees',
  resolveEmployeesCliMetadata,
  async (container, payload) => {
    const { resolveEmployeesCommand } = await import('@ai-team/service/src/commands/info.js');
    return resolveEmployeesCommand(container.workspaceRoot, payload.query);
  }
);
