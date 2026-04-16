import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { COMMAND_FACTORY_TOKENS } from '@ai-team/service';
import { createResolverCommandDefinition } from './shared.js';

export const skillsRemoveCliMetadata: CliCommandMetadata = {
  key: 'skills.remove',
  command: 'remove',
  parentKey: 'skills',
  description: 'Remove a skill from an agent',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '--agent <agent>', description: 'Agent id, name, or role query' },
    { flags: '--skill <skill>', description: 'Skill name to remove' },
    { flags: '--json', description: 'Output as JSON' },
  ],
};

export const skillsRemoveCommandDefinition = createResolverCommandDefinition(
  'skillsRemove',
  skillsRemoveCliMetadata,
  (container, handlerToken) => {
    container.registerTransient(handlerToken, (resolver) => async (payload) => {
      const { removeSkillCommand } = await import('@ai-team/service/src/commands/skills.js');
      return removeSkillCommand(
        resolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        resolver.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        {
          agent: payload.agent,
          skill: payload.skill,
        }
      );
    });
  }
);
