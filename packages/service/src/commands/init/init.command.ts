import { z } from 'zod';
import type { InitOptions } from '@ai-team/api-contracts';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import { InitCommand } from './init.js';
import type { InitRuntimeHooks } from './workflow-questions.js';
import type { IQuestionService } from '../../questions/question-service.js';

type Params = z.infer<typeof InitICommand.schema>;
const _initICommandSchema = z.object({
  options: z.any().optional(),
});

export const InitICommandMetadata = {
  key: 'init',
  cli: { command: 'init' },
  description: 'Initialize AI Team in current workspace',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  parameters: _initICommandSchema,
} satisfies ICommandDescriptor;

export class InitICommand implements ICommand<Params, void> {
  static readonly schema = _initICommandSchema;
  readonly metadata = InitICommandMetadata;

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
