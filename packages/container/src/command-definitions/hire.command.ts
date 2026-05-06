import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const hireCliMetadata: CliCommandMetadata = {
  key: 'hire',
  command: 'hire',
  description: 'Hire a new team member',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '-n, --name <name>', description: 'Employee name' },
    { flags: '-r, --role <role>', description: 'Unique role name' },
    { flags: '-s, --skill <skill>', description: 'Skill from catalog' },
    {
      flags: '-t, --type <type>',
      description: 'Role type (executive, team-lead, individual-contributor, etc.)',
    },
    { flags: '--reports-to <agent>', description: 'Manager employee ID' },
    { flags: '--no-chat', description: 'Skip the onboarding chat phase' },
  ],
};

export const hireCommandDefinition = createFactoryCommandDefinition(
  'hire',
  hireCliMetadata,
  async (container, payload, context) => {
    const { HireCommand } = await import('@ai-team/service/src/commands/hire.js');
    const { COMMAND_FACTORY_TOKENS } = await import('@ai-team/service/src/commands/definitions/types.js');
    return new HireCommand(
      container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      container.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
    ).execute(payload.options, context);
  }
);
