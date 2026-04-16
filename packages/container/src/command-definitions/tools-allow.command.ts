import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { COMMAND_FACTORY_TOKENS } from '@ai-team/service';
import { confirmGovernanceAction, resolveRequestedBy } from './governance-helpers.js';
import { createResolverCommandDefinition } from './shared.js';

export const toolsAllowCliMetadata: CliCommandMetadata = {
  key: 'tools.allow',
  command: 'allow',
  parentKey: 'tools',
  description:
    'Allow a tool for an agent (governed; prompts for explicit approval unless provided)',
  llmCallable: true,
  directCli: true,
  aliases: ['add'],
  options: [
    { flags: '--agent <agent>', description: 'Agent id, name, or role query' },
    { flags: '--tool <tool>', description: 'Tool name to allow' },
    {
      flags: '--requested-by <agent>',
      description:
        'Governance actor requesting the change (default policy typically allows CEO or HR Director)',
    },
    {
      flags: '--approved-by-user',
      description: 'Mark user approval as granted and skip interactive confirmation prompt',
    },
    { flags: '--json', description: 'Output as JSON' },
  ],
};

export const toolsAllowCommandDefinition = createResolverCommandDefinition(
  'toolsAllow',
  toolsAllowCliMetadata,
  (container, handlerToken) => {
    container.registerTransient(handlerToken, (resolver) => async (payload, context) => {
      const { toolAllowCommand } = await import('@ai-team/service/src/commands/tools.js');
      const requestedBy = await resolveRequestedBy(
        payload.requestedBy,
        context,
        'requestedBy is required for tool governance'
      );

      return toolAllowCommand(
        resolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        resolver.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
        { agent: payload.agent, tool: payload.tool },
        {
          requestedBy,
          confirmUserApproval: async () =>
            confirmGovernanceAction(
              payload.approvedByUser,
              context,
              `Approve tool_allow by ${requestedBy} for agent '${payload.agent}' and tool '${payload.tool}'?`
            ),
        }
      );
    });
  }
);
