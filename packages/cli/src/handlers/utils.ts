import { createContainer, TOKENS } from '@ai-team/container';

/**
 * Delete all agents with the given roles from the workspace.
 */
export async function deleteAgentsByRole(workspaceRoot: string, roles: string[]) {
  const container = createContainer({ workspaceRoot });
  const agentManager = container.resolve(TOKENS.AgentManager);
  const agents = await agentManager.getAllAgentsAsync();
  for (const role of roles) {
    for (const agent of agents.filter((a) => a.role === role)) {
      if (agent.filePath && agent.filePath.endsWith('.md')) {
        const fs = await import('fs/promises');
        await fs.unlink(agent.filePath);
      }
    }
  }
}

/**
 * Check if an agent with a unique role already exists.
 */
export async function uniqueRoleExists(workspaceRoot: string, role: string): Promise<boolean> {
  const container = createContainer({ workspaceRoot });
  const agentManager = container.resolve(TOKENS.AgentManager);
  return (await agentManager.getAllAgentsAsync()).some((a) => a.role === role);
}
