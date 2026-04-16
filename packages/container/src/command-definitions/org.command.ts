import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const orgCliMetadata: CliCommandMetadata = {
  key: 'org',
  command: 'org',
  description: 'Show organization hierarchy',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '-o, --output <file>', description: 'Export to JSON or Mermaid (with --mermaid)' },
    { flags: '--mermaid', description: 'Output Mermaid diagram text instead of ASCII tree' },
  ],
};

export const orgCommandDefinition = createFactoryCommandDefinition(
  'getOrganizationGraph',
  orgCliMetadata,
  async (container) => {
    const { getOrganizationGraphCommand } = await import('@ai-team/service/src/commands/graph.js');
    return getOrganizationGraphCommand(container.workspaceRoot);
  }
);
