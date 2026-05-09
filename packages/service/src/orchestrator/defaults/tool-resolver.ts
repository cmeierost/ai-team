/**
 * DefaultToolResolver — default IToolResolver.
 * Returns the set of tools the agent is permitted to use for the normal chat
 * workflow.
 *
 * NOTE: `hr_hire` is intentionally excluded from this default path; hiring is
 * planned as a dedicated workflow rather than a side-effect in normal chat turns.
 */

import type { AgentTool } from '@ai-team/core';
import type { IToolResolver } from '../pipeline.js';
import type { OrchestratorContext } from '../pipeline-context.js';
import { toolKey, type ToolManager } from '../../tools/tool-manager.js';

export class DefaultToolResolver implements IToolResolver {
  constructor(private readonly toolManager: ToolManager) {}

  async resolve(ctx: OrchestratorContext): Promise<AgentTool[]> {
    return this.toolManager.getForAgent(ctx.agent).filter((tool) => toolKey(tool) !== 'hr_hire');
  }
}
