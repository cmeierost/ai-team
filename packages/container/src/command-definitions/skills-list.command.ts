import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { COMMAND_FACTORY_TOKENS } from '@ai-team/service';
import { createResolverCommandDefinition } from './shared.js';

export const skillsListCliMetadata: CliCommandMetadata = {
  key: 'skills',
  command: 'skills',
  description: 'Search available skills and optionally show whether they are assigned to an agent',
  llmCallable: true,
  directCli: true,
  options: [
    {
      flags: '--query <query>',
      description: 'Filter skills by name, description, responsibility, or tool',
    },
    { flags: '--agent <agent>', description: 'Annotate assignment state for a specific agent' },
    { flags: '--json', description: 'Output as JSON' },
  ],
};

export const skillsListCommandDefinition = createResolverCommandDefinition(
  'skillsList',
  skillsListCliMetadata,
  (container, handlerToken) => {
    container.registerTransient(handlerToken, (resolver) => async (payload) => {
      const { searchSkillsCommand } = await import('@ai-team/service/src/commands/skills.js');
      return searchSkillsCommand(
        resolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        resolver.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        {
          query: payload.query,
          agent: payload.agent,
        }
      );
    });
  }
);
