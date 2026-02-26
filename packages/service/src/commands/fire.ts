import fs from 'fs/promises';
import { AgentManager } from '@ai-team/core';
import type { FireOptions } from '../contracts.js';

export async function fireCommand(workspaceRoot: string, agentQuery: string, options: FireOptions) {
  if (!options.force) {
    throw new Error('Confirmation required before firing an agent. Re-run with force=true once confirmed by the client.');
  }

  const agentManager = new AgentManager(workspaceRoot);
  await agentManager.initialize();
  const matches = agentManager.resolveAgent(agentQuery);

  if (matches.length === 0) {
    throw new Error(`No agent found matching "${agentQuery}".`);
  }

  let agent;
  if (matches.length > 1) {
    const summary = matches.map(m => `${m.name} (${m.role}) [${m.id}]`).join(', ');
    throw new Error(`Multiple agents match "${agentQuery}": ${summary}`);
  } else {
    agent = matches[0];
  }

  if (agent.filePath && agent.filePath.endsWith('.md')) {
    await fs.unlink(agent.filePath);
  } else {
    throw new Error('Could not determine agent file path.');
  }
}
