import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const graphCliMetadata: CliCommandMetadata = {
  key: 'graph',
  command: 'graph',
  description: 'Generate team graph',
  llmCallable: true,
  directCli: true,
  options: [
    {
      flags: '-m, --mode <mode>',
      description: 'View mode: hierarchy, features, expertise, matrix',
      defaultValue: 'hierarchy',
    },
    { flags: '-o, --output <file>', description: 'Export to file (SVG, PNG, or JSON)' },
  ],
};

export const graphCommandDefinition = createFactoryCommandDefinition(
  'getTeamGraph',
  graphCliMetadata,
  async (container, payload) => {
    const { getTeamGraphCommand } = await import('@ai-team/service/src/commands/graph.js');
    return getTeamGraphCommand(container.workspaceRoot, payload.mode ?? 'hierarchy');
  }
);
