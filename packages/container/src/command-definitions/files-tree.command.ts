import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const filesTreeCliMetadata: CliCommandMetadata = {
  key: 'files',
  command: 'files',
  description:
    'Preview the workspace file tree with gitignore awareness and optional agent-scoped filtering',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '-d, --depth <number>', description: 'Max recursion depth (default: 4)' },
    { flags: '-a, --all', description: 'Include hidden files and directories' },
    { flags: '--no-gitignore', description: 'Ignore .gitignore rules and show all files' },
    { flags: '--json', description: 'Output as JSON' },
    { flags: '--agent <id>', description: 'Show files accessible to a specific agent' },
    {
      flags: '--writeable',
      description: 'Show writeable files instead of readable (requires --agent)',
    },
  ],
};

export const filesTreeCommandDefinition = createFactoryCommandDefinition(
  'filesTree',
  filesTreeCliMetadata,
  async (container, payload) => {
    const { FileTreeCommand } = await import('@ai-team/service/src/commands/file-tree.js');
    const { COMMAND_FACTORY_TOKENS } = await import('@ai-team/service/src/commands/definitions/types.js');
    return new FileTreeCommand(
      container.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      container.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      container.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
      container.resolve(COMMAND_FACTORY_TOKENS.FileTreeService),
      container.resolve(COMMAND_FACTORY_TOKENS.FileAnnotationService)
    ).filesTree(payload);
  }
);
