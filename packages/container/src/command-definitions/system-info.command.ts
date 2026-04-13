import type { CliCommandMetadata } from '@ai-team/infrastructure';
import { createFactoryCommandDefinition } from './shared.js';

export const systemInfoCliMetadata: CliCommandMetadata = {
  key: 'sysinfo',
  command: 'sysinfo',
  description: 'Display system information about the workspace',
  llmCallable: true,
  directCli: true,
  aliases: ['sys'],
  options: [{ flags: '--json', description: 'Output as JSON' }],
};

export const systemInfoCommandDefinition = createFactoryCommandDefinition(
  'systemInfo',
  systemInfoCliMetadata,
  async (container) => {
    const { getSystemInfo } = await import('@ai-team/service/src/utils/system-info.js');
    return getSystemInfo(container.workspaceRoot);
  }
);
