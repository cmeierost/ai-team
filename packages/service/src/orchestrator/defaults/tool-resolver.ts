/**
 * DefaultToolResolver — default IToolResolver.
 * Returns toolManager.getForAgent(agent) — the set of tools the agent is permitted
 * to use based on its explicit tool grants and HR permissions.
 */

import type { AgentTool } from '@ai-team/infrastructure';
import type { IToolResolver } from '../pipeline.js';
import type { OrchestratorContext } from '../pipeline-context.js';

export class DefaultToolResolver implements IToolResolver {
  async resolve(ctx: OrchestratorContext): Promise<AgentTool[]> {
    return ctx.toolManager.getForAgent(ctx.agent);
  }
}
