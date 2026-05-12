import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import { emitLog } from './stream-events.js';

export class WorkflowSlashCommand implements ICommand<string, void> {
  readonly key = 'workflow';
  readonly description = 'Run workflow tools (/workflow list or /workflow <id>)';
  readonly availableIn = { chat: true, tool: false, cli: false };
  readonly group = 'workflow';

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const input = args.trim();
    const toolName = !input || input === 'list' ? 'workflow_list' : `workflow_${input}`;

    const result = await (ctx as any).toolManager.execute(
      ctx.agent!,
      toolName,
      {},
      {
        agentId: ctx.agent!.id,
        workspaceRoot: ctx.workspaceRoot,
      }
    );

    if (!result.ok) {
      emitLog(
        (ctx as any).hooks,
        'error',
        result.error ?? `Workflow command failed for tool '${toolName}'.`
      );
      return { status: 'ok' };
    }

    emitLog((ctx as any).hooks, 'info', `[workflow] ${JSON.stringify(result.result)}`);
    return { status: 'ok' };
  }
}
