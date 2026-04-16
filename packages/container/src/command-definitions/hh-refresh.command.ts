import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const hhRefreshCliMetadata: CliCommandMetadata = {
  key: 'hh.refresh',
  command: 'refresh',
  parentKey: 'hh',
  description: 'Pull and refresh the skill catalog from GitHub',
  llmCallable: true,
  directCli: true,
};

export const hhRefreshCommandDefinition = createFactoryCommandDefinition(
  'hhRefresh',
  hhRefreshCliMetadata,
  async (container) => {
    const { hhRefreshCommand } = await import('@ai-team/service/src/commands/hh.js');
    return hhRefreshCommand(container.workspaceRoot);
  }
);
