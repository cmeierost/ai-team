import type {
  ICommand,
  ICommandDescriptor,
  ExecutionContext,
  CommandResponse,
  IEmitService,
} from '@ai-team/core';
import type { ToolManager } from '../tools/tool-manager.js';

export class WorkflowSlashCommand implements ICommand<string, void> {
  constructor(
    private readonly emitService: IEmitService,
    private readonly toolManager: Pick<ToolManager, 'execute'>,
    private readonly workspaceRoot: string
  ) {}

  readonly metadata: ICommandDescriptor<string> = {
    key: 'workflow',
    description: 'Run workflow tools (/workflow list or /workflow <id>)',
    availableIn: { chat: true, tool: false, cli: false },
    group: 'workflow',
  };

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const input = args.trim();
    const toolName = !input || input === 'list' ? 'workflow_list' : `workflow_${input}`;

    const result = await this.toolManager.execute(
      ctx.agent!,
      toolName,
      {},
      {
        history: [],
        agentId: ctx.agent!.id,
      }
    );

    if (!result.ok) {
      this.emitService.log(
        'error',
        result.error ?? `Workflow command failed for tool '${toolName}'.`
      );
      return { status: 'ok' };
    }

    this.emitService.log('info', `[workflow] ${JSON.stringify(result.result)}`);
    return { status: 'ok' };
  }
}
