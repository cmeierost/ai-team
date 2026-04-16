import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

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
    const { avatarCommand } = await import('@ai-team/service/src/commands/avatar.js');
    return avatarCommand(container.workspaceRoot, payload.options, context);
  }
);
