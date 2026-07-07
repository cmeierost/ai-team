/**
 * WorkflowToolResolver — applies a WorkflowToolPolicy overlay on top of
 * the agent's default tool set.
 *
 * Policy order: deny > allow > remove > add
 * - `deny` removes tools by canonical key (e.g. "fs_write")
 * - `allow` restricts to only the listed tools
 * - `remove` removes tools from the default set
 * - `add` adds tools to the default set
 */

import type { ICommand, ExecutionContext } from '@ai-team/core';
import type { IToolResolver } from '../pipeline.js';
import { ToolIdentity } from '../../tools/tool-manager.js';
import type { WorkflowToolPolicy } from '../../workflow/chat-loop-contracts.js';

export class WorkflowToolResolver implements IToolResolver {
  constructor(
    private readonly baseResolver: IToolResolver,
    private readonly policy: WorkflowToolPolicy
  ) {}

  async resolve(ctx: ExecutionContext): Promise<ICommand[]> {
    let tools = await this.baseResolver.resolve(ctx);

    // Apply deny list first
    if (this.policy.deny?.length) {
      const denySet = new Set(this.policy.deny);
      tools = tools.filter((t) => !denySet.has(ToolIdentity.key(t.metadata)));
    }

    // Apply allow list (restrict to only these tools)
    if (this.policy.allow?.length) {
      const allowSet = new Set(this.policy.allow);
      tools = tools.filter((t) => allowSet.has(ToolIdentity.key(t.metadata)));
    }

    // Apply remove list
    if (this.policy.remove?.length) {
      const removeSet = new Set(this.policy.remove);
      tools = tools.filter((t) => !removeSet.has(ToolIdentity.key(t.metadata)));
    }

    return tools;
  }
}
