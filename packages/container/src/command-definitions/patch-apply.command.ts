import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const patchCliMetadata: CliCommandMetadata = {
  key: 'patch',
  command: 'patch <file> <line> <content>',
  description:
    'Replace one or more lines in a file and send a code-edit proposal through the configured editor adapter',
  llmCallable: false,
  directCli: true,
  arguments: [{ syntax: '[rest...]', description: 'Additional <line> <content> pairs' }],
};

export const patchApplyCommandDefinition = createFactoryCommandDefinition(
  'patchApply',
  patchCliMetadata,
  async (container, payload) => {
    const { patchApplyCommandAsync } = await import('@ai-team/service/src/commands/patch.js');
    return patchApplyCommandAsync(container.workspaceRoot, payload);
  }
);
