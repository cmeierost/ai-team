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
import type { IInteractionService } from '../../questions/question-service.js';

type Params = z.infer<typeof InitICommand.schema>;
const _initICommandSchema = z.object({
  options: z.any().optional(),
});

export const InitICommandMetadata = {
  key: 'init',
  description: 'Initialize AI Team in current workspace',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  path: ['init'],
  parameters: _initICommandSchema,
} satisfies ICommandDescriptor;

export class InitICommand implements ICommand<Params, void> {
  static readonly schema = _initICommandSchema;
  readonly metadata = InitICommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly questionService: IInteractionService,
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
      questionInput: (request) => this.questionService.input(request),
      questionConfirm: (request) => this.questionService.confirm(request),
      questionSelect: (request) => this.questionService.select(request),
      questionPassword: (request) => this.questionService.password(request),
      questionChecklist: (request) => this.questionService.checklist(request),
      workflowState: runtime.workflowState as InitRuntimeHooks['workflowState'],
      onWorkflowFrame: runtime.onWorkflowFrame,
    };
  }
}
