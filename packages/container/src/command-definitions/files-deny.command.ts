import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { COMMAND_FACTORY_TOKENS } from '@ai-team/service';
import { confirmGovernanceAction, resolveRequestedBy } from './governance-helpers.js';
import { createResolverCommandDefinition } from './shared.js';

export const filesDenyCliMetadata: CliCommandMetadata = {
  key: 'files.disallow',
  command: 'disallow <path>',
  parentKey: 'files',
  description:
    'Disallow a path from file visibility (global config) or agent access rules (governed when --agent is used)',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '--agent <id>', description: 'Scope to a specific agent (updates their .md permissions)' },
    {
      flags: '--requested-by <agent>',
      description:
        'Governance actor requesting the change (default policy typically allows CEO or HR Director)',
    },
    {
      flags: '--approved-by-user',
      description: 'Mark user approval as granted and skip interactive confirmation prompt',
    },
    { flags: '--write', description: 'Affect write permissions instead of read (default: read)' },
    { flags: '--mode <mode>', description: 'Permission mode: read | write | create | delete' },
  ],
};

export const filesDenyCommandDefinition = createResolverCommandDefinition(
  'filesDeny',
  filesDenyCliMetadata,
  (container, handlerToken) => {
    container.registerTransient(handlerToken, (resolver) => async (payload, context) => {
      const { permissionDenyCommand, disallowPathCommand } = await import(
        '@ai-team/service/src/commands/file-tree.js'
      );

      const mode =
        payload.mode === 'write' || payload.mode === 'create' || payload.mode === 'delete'
          ? 'write'
          : 'read';

      if (payload.agent) {
        const requestedBy = await resolveRequestedBy(
          payload.requestedBy,
          context,
          'requestedBy is required for agent governance'
        );

        const result = await permissionDenyCommand(
          container.workspaceRoot,
          resolver.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
          resolver.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
          payload.agent,
          payload.path,
          {
            requestedBy,
            confirmUserApproval: async () =>
              confirmGovernanceAction(
                payload.approvedByUser,
                context,
                `Approve access_deny by ${requestedBy} for agent '${payload.agent}', mode '${mode}', path '${payload.path}'?`
              ),
          },
          mode
        );
        return { paths: result.paths };
      }

      const paths = await disallowPathCommand(
        container.workspaceRoot,
        resolver.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        payload.path,
        mode
      );
      return { paths };
    });
  }
);
