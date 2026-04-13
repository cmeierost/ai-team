import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const testConnectionCliMetadata: CliCommandMetadata = {
  key: 'test-connection',
  command: 'test-connection',
  description: 'Test LLM provider/model connectivity',
  llmCallable: true,
  directCli: true,
  options: [
    {
      flags: '-e, --employee <employee>',
      description: 'Resolve employee by fuzzy search and test their effective model/provider',
    },
    {
      flags: '-p, --provider <providerRef>',
      description: 'Provider reference key in config.providers',
    },
    { flags: '--model-key <modelKey>', description: 'Model key from provider models dictionary' },
    { flags: '--model <modelId>', description: 'Direct model ID override (bypasses model key)' },
    {
      flags: '--all',
      description: 'Test all configured model keys (optionally scoped by --provider)',
    },
  ],
};

export const testConnectionCommandDefinition = createFactoryCommandDefinition(
  'testConnection',
  testConnectionCliMetadata,
  async (container, payload) => {
    const { testConnectionCommand } = await import('@ai-team/service/src/commands/test-connection.js');
    return testConnectionCommand(container.workspaceRoot, payload.options);
  }
);
