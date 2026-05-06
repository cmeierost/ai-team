import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { COMMAND_FACTORY_TOKENS } from '@ai-team/service';
import { createResolverCommandDefinition } from './shared.js';

export const skillsAddCliMetadata: CliCommandMetadata = {
  key: 'skills.add',
  command: 'add',
  parentKey: 'skills',
  description: 'Add a skill to an agent',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '--agent <agent>', description: 'Agent id, name, or role query' },
    { flags: '--skill <skill>', description: 'Skill name to add' },
    { flags: '--json', description: 'Output as JSON' },
  ],
};

export const skillsAddCommandDefinition = createResolverCommandDefinition(
  'skillsAdd',
  skillsAddCliMetadata,
  (container, handlerToken) => {
    container.registerTransient(handlerToken, (resolver) => async (payload) => {
      const { addSkillCommand } = await import('@ai-team/service/src/commands/skills.js');
      return addSkillCommand(
        resolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        resolver.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        resolver.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService),
        {
          agent: payload.agent,
          skill: payload.skill,
        }
      );
    });
  }
);
