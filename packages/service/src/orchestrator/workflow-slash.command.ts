import type {
  ICommand,
  ICommandDescriptor,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { IEmitService } from './services/emit-service.js';
import { getServiceContainer } from '../service-registry.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';

export class WorkflowSlashCommand implements ICommand<string, void> {
  constructor(private readonly emitService: IEmitService) {}

  readonly metadata: ICommandDescriptor<string> = {
    key: 'workflow',
    description: 'Run workflow tools (/workflow list or /workflow <id>)',
    availableIn: { chat: true, tool: false, cli: false },
    group: 'workflow',
  };

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const input = args.trim();
    const toolName = !input || input === 'list' ? 'workflow_list' : `workflow_${input}`;

    const toolManager = getServiceContainer().resolve(COMMAND_FACTORY_TOKENS.ToolManager);
    const result = await toolManager.execute(
      ctx.agent!,
      toolName,
      {},
      {
        agentId: ctx.agent!.id,
        workspaceRoot: ctx.workspaceRoot,
        history: [],
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
