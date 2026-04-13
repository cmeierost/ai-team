import type { CliCommandMetadata } from '@ai-team/infrastructure';
import type { PermissionOverlapReport } from '@ai-team/api-client';
import { createFactoryCommandDefinition } from './shared.js';

export const accessOverlapCliMetadata: CliCommandMetadata = {
  key: 'access.overlap',
  command: 'overlap',
  parentKey: 'access',
  description: 'Analyze overlap between agent .perm file responsibilities by right',
  llmCallable: true,
  directCli: true,
  options: [
    {
      flags: '--mode <mode>',
      description: 'Analysis mode: files | patterns',
      defaultValue: 'files',
    },
    {
      flags: '--right <right>',
      description: 'Optional right filter (read, write, create, delete, list)',
    },
    { flags: '--agent <agent>', description: 'Optional exact agent id filter' },
    { flags: '--json', description: 'Output as JSON' },
  ],
};

export const accessOverlapCommandDefinition = createFactoryCommandDefinition(
  'accessOverlap',
  accessOverlapCliMetadata,
  async (container, payload) => {
    const { analyzeWorkspacePermissionOverlap } = await import('@ai-team/infrastructure');
    const result = await analyzeWorkspacePermissionOverlap(container.workspaceRoot, {
      mode: payload.mode,
      agentId: payload.agent,
    });
    return result as unknown as PermissionOverlapReport;
  }
);
