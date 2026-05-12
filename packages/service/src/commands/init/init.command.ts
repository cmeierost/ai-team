import { z } from 'zod';
import type { InitOptions } from '@ai-team/api-contracts';
import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { SessionManager } from '../../session-manager.js';
import type { InitCommand } from './init.js';
import type { InitRuntimeHooks } from './workflow-questions.js';

type Params = z.infer<typeof InitICommand.schema>;

function runtimeToInitHooks(runtime: ExecutionContext): InitRuntimeHooks {
  return {
    signal: runtime.signal,
    emit: runtime.emit as InitRuntimeHooks['emit'],
    questionInput: runtime.questionInput,
    questionConfirm: runtime.questionConfirm,
    questionSelect: runtime.questionSelect,
    questionPassword: runtime.questionPassword,
    questionChecklist: runtime.questionChecklist,
    workflowState: runtime.workflowState as InitRuntimeHooks['workflowState'],
    onWorkflowFrame: runtime.onWorkflowFrame,
  };
}

export class InitICommand implements ICommand<Params, void> {
  static readonly schema = z.object({
    options: z.any().optional(),
  });

  readonly key = 'init';
  readonly cli = { command: 'init' };
  readonly description = 'Initialize AI Team in current workspace';
  readonly availableIn = { cli: true, chat: true };
  readonly group = 'setup';
  readonly parameters = InitICommand.schema;

  constructor(
    private readonly initCommand: Pick<InitCommand, 'execute'>,
    private readonly sessionManager?: SessionManager
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    await this.initCommand.execute(
      {
        workspaceRoot: ctx.workspaceRoot,
        options: (payload.options ?? {}) as InitOptions,
        injected: this.sessionManager ? { sessionManager: this.sessionManager } : undefined,
      },
      runtimeToInitHooks(ctx)
    );
    return { status: 'ok' };
  }
}
