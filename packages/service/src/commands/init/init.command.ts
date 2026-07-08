import { z } from 'zod';
import type { InitOptions } from '@ai-team/api-contracts';
import type { ICommand, CommandResponse, ICommandDescriptor } from '@ai-team/core';
import { InitCommand, initCommand } from './init.js';
import type { InitRuntimeHooks } from './workflow-questions.js';
import type { IQuestionService } from '../../questions/question-service.js';
import type { IEmitService } from '@ai-team/core';

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
    private readonly emitService: IEmitService,
    private readonly questionService?: IQuestionService,
    private readonly initCmd?: InitCommand
  ) {}

  async execute(payload: Params, ctxOrUnused?: unknown, ctx?: any): Promise<CommandResponse<void>> {
    const resolvedCtx = (ctx ?? ctxOrUnused) as unknown as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (this.initCmd) {
      await this.initCmd.execute(
        { workspaceRoot: this.workspaceRoot, options: (payload.options ?? {}) as InitOptions },
        this.buildHooks(resolvedCtx)
      );
    } else {
      await initCommand(
        this.workspaceRoot,
        (payload.options ?? {}) as InitOptions,
        this.buildHooks(resolvedCtx)
      );
    }
    return { status: 'ok' };
  }

  private buildHooks(runtime: any): InitRuntimeHooks {
    const noop = (): Promise<never> => Promise.reject(new Error('not available'));
    return {
      signal: runtime?.signal,
      emitService: this.emitService,
      questionInput: (request) => this.questionService?.input(request) ?? noop(),
      questionConfirm: (request) =>
        this.questionService?.confirm(request) ?? (() => Promise.resolve(false))(),
      questionSelect: (request) => this.questionService?.select(request) ?? noop(),
      questionPassword: (request) => this.questionService?.password(request) ?? noop(),
      questionChecklist: (request) => this.questionService?.checklist(request) ?? noop(),
      workflowState: runtime?.workflowState as InitRuntimeHooks['workflowState'],
    };
  }
}
