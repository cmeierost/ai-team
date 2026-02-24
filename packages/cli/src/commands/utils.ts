import fs from 'fs/promises';
import path from 'path';
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

/**
 * Check if an agent with a unique role already exists.
 */
export async function uniqueRoleExists(workspaceRoot: string, role: string): Promise<boolean> {
  const agentManager = new AgentManager(workspaceRoot);
  await agentManager.initialize();
  return agentManager.getAllAgents().some(a => a.role === role);
}
