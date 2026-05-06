import fs from 'fs/promises';
import type { IAgentManager } from '@ai-team/core';

export class DeleteAgentsByRoleCommand {
  constructor(private readonly agentManager: IAgentManager) {}

  async execute(roles: string[]): Promise<void> {
    const agents = await this.agentManager.getAllAgentsAsync();
    for (const role of roles) {
      for (const agent of agents.filter((a) => a.role === role)) {
        if (agent.filePath && agent.filePath.endsWith('.md')) {
          await fs.unlink(agent.filePath);
        }
      }
    }
  }
}
