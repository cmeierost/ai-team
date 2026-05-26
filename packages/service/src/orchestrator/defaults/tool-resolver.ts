/**
 * DefaultToolResolver — default IToolResolver.
 * Returns the set of tools the agent is permitted to use for the normal chat
 * workflow.
 *
 * NOTE: `hr_hire` is intentionally excluded from this default path; hiring is
 * planned as a dedicated workflow rather than a side-effect in normal chat turns.
 */

import type { ICommand, ExecutionContext } from '@ai-team/core';
import type { IToolResolver } from '../pipeline.js';
import { ToolIdentity, type ToolManager } from '../../tools/tool-manager.js';

export class DefaultToolResolver implements IToolResolver {
  constructor(private readonly toolManager: ToolManager) {}

  async resolve(ctx: ExecutionContext): Promise<ICommand[]> {
    return this.toolManager
      .getForAgent(ctx.agent!)
      .filter((tool) => ToolIdentity.key(tool.metadata) !== 'hr_hire');
  }
}
