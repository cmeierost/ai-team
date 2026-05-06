import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';
import { TOKENS } from '../service-bootstrap.js';

export const avatarCliMetadata: CliCommandMetadata = {
  key: 'avatar',
  command: 'avatar <agent>',
  description: 'Download and set an avatar picture for an agent',
  llmCallable: true,
  directCli: true,
};

export const avatarCommandDefinition = createFactoryCommandDefinition(
  'avatar',
  avatarCliMetadata,
  async (container, payload, context) => {
    const { AvatarCommand } = await import('@ai-team/service/src/commands/avatar.js');
    const cmd = new AvatarCommand(
      container.resolve(TOKENS.AgentManager),
      container.resolve(TOKENS.ConfigurationStorage),
      container.resolve(TOKENS.EnvironmentStorage),
      container.resolve(TOKENS.AvatarManager)
    );
    return cmd.execute(payload.options, context);
  }
);
