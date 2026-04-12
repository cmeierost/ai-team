import type { IContextService } from '@ai-team/api-client';
import type { AgentManager } from '@ai-team/infrastructure';
import { NotFoundError } from '../http-errors.js';

export class MetaService implements IContextService {
  constructor(private readonly agentManager: AgentManager) {}

  async getContextEstimate(agentId: string): Promise<unknown> {
    const agent = await this.agentManager.getAgentAsync(agentId);
    if (!agent) throw new NotFoundError(`Agent '${agentId}' not found`);
    const segments: Array<{ label: string; key: string; chars: number }> = [];
    segments.push({
      label: 'Identity',
      key: 'identity',
      chars: Math.round([`You are ${agent.name}`, agent.role ?? ''].join('\n').length),
    });
    if ((agent as any).markdown)
      segments.push({ label: 'Bio', key: 'bio', chars: (agent as any).markdown.length });
    const totalChars = segments.reduce((s, x) => s + x.chars, 0);
    return { agentId: agent.id, segments, totalChars };
  }
}
