import type { IAgentManager } from '@ai-team/core';
import type { Employee } from '@ai-team/api-contracts';

export class ResolveEmployeesCommand {
  constructor(private readonly agentManager: IAgentManager) {}

  async execute(query: string): Promise<Employee[]> {
    return this.agentManager.resolveAgentAsync(query);
  }
}
