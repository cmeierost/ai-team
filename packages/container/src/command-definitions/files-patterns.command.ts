import type { CliCommandMetadata } from '@ai-team/infrastructure';
import type { FilesPatternsResponse } from '@ai-team/api-client';
import { createFactoryCommandDefinition } from './shared.js';

export const filesPatternsCliMetadata: CliCommandMetadata = {
  key: 'files.patterns',
  command: 'patterns',
  parentKey: 'files',
  description: 'List configured file permission patterns (global or per-agent)',
  llmCallable: true,
  directCli: true,
  options: [
    { flags: '--agent <id>', description: 'Show patterns for a specific agent' },
    { flags: '--json', description: 'Output as JSON' },
  ],
};

export const filesPatternsCommandDefinition = createFactoryCommandDefinition(
  'filesPatterns',
  filesPatternsCliMetadata,
  async (container, payload) => {
    const { AgentManager, loadAgentAccessPatterns, loadTeamConfig } =
      await import('@ai-team/infrastructure');

    const config = await loadTeamConfig(container.workspaceRoot);
    const global = {
      read: config?.fileTree?.readPaths ?? [],
      write: config?.fileTree?.writePaths ?? [],
    };

    if (!payload.agent) {
      return { global } as FilesPatternsResponse;
    }

    const manager = new AgentManager(container.workspaceRoot);
    const matches = await manager.resolveAgentAsync(payload.agent);
    if (matches.length === 0) {
      throw new Error(`Agent not found: "${payload.agent}"`);
    }
    const agent = matches[0];
    const patterns = await loadAgentAccessPatterns(container.workspaceRoot, agent.id);

    return {
      global,
      agent: { id: agent.id, name: agent.name, role: agent.role },
      agentPatterns: { read: patterns.read ?? [], write: patterns.write ?? [] },
    } as FilesPatternsResponse;
  }
);
