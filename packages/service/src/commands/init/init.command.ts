import { z } from 'zod';
import type { InitOptions } from '@ai-team/api-contracts';
import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import { InitCommand } from './init.js';
import type { InitRuntimeHooks } from './workflow-questions.js';
import type { IQuestionService } from '../../questions/question-service.js';

type Params = z.infer<typeof InitICommand.schema>;

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
    private readonly workspaceRoot: string,
    private readonly questionService: IQuestionService,
    private readonly initCmd: InitCommand
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    await this.initCmd.execute(
      { workspaceRoot: this.workspaceRoot, options: (payload.options ?? {}) as InitOptions },
      this.buildHooks(ctx)
    );
    return { status: 'ok' };
  }

  private buildHooks(runtime: ExecutionContext): InitRuntimeHooks {
    return {
      signal: runtime.signal,
      emit: runtime.emit,
      questionInput: (request) => this.questionService.questionInput(request),
      questionConfirm: (request) => this.questionService.questionConfirm(request),
      questionSelect: (request) => this.questionService.questionSelect(request),
      questionPassword: (request) => this.questionService.questionPassword(request),
      questionChecklist: (request) => this.questionService.questionChecklist(request),
      workflowState: runtime.workflowState as InitRuntimeHooks['workflowState'],
      onWorkflowFrame: runtime.onWorkflowFrame,
    };
  }
}
