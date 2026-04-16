import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { COMMAND_FACTORY_TOKENS } from '@ai-team/service';
import { createResolverCommandDefinition } from './shared.js';

export const toolsListCliMetadata: CliCommandMetadata = {
  key: 'tools',
  command: 'tools',
  description: 'List available tools and optionally annotate permissions for an agent',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '--agent <agent>', description: 'Show tool allow/deny state for a specific agent' },
    { flags: '--json', description: 'Output as JSON' },
  ],
};

export const toolsListCommandDefinition = createResolverCommandDefinition(
  'toolsList',
  toolsListCliMetadata,
  (container, handlerToken) => {
    container.registerTransient(handlerToken, (resolver) => async (payload) => {
      const { listToolsCommand } = await import('@ai-team/service/src/commands/tools.js');
      return listToolsCommand(
        resolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        resolver.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
        { agent: payload.agent }
      );
    });
  }
);
