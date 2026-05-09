import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class WorkflowChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'workflow';
  readonly aliases = ['wf'];
  readonly usage = '/workflow [list|<workflow-id>]';
  readonly description =
    'List available workflows or show one workflow definition via workflow tools.';
  readonly availableIn = { chat: true, tool: false, cli: true };
  readonly group = 'chat';

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const trimmed = args.trim();
    const query = trimmed.length === 0 ? 'list' : trimmed;

    const toolName = query === 'list' ? 'workflow_list' : `workflow_${query}`;

    const result = await ctx.toolManager.execute(ctx.agent, toolName, {}, {
      agentId: ctx.agent.id,
      workspaceRoot: ctx.workspaceRoot,
    });

    if (!result.ok) {
      write(ctx, `Workflow command failed (${toolName}): ${result.error ?? 'unknown error'}`);
      return;
    }

    const pretty =
      typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);

    write(ctx, `\nWorkflow result (${query}):\n${pretty}`);
    ctx.lastManualOutput = `Workflow: ${query}\n\n${pretty}`;
    write(ctx, '\n(Result not in context — use /context add to include it.)');
  }
}
