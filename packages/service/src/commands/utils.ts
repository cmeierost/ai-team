import fs from 'fs/promises';
import { AgentManager } from '@ai-team/core';

/**
 * Delete all agents with the given roles from the workspace.
 */
export async function deleteAgentsByRole(workspaceRoot: string, roles: string[]) {
  const agentManager = new AgentManager(workspaceRoot);
  await agentManager.initialize();
  const agents = agentManager.getAllAgents();
  for (const role of roles) {
    for (const agent of agents.filter(a => a.role === role)) {
      if (agent.filePath && agent.filePath.endsWith('.md')) {
        await fs.unlink(agent.filePath);
      }
    }
  }
}
