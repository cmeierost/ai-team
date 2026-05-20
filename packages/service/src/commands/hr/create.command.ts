import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ISkillManager,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { InteractionContext } from '@ai-team/api-contracts';
import { CreateCommand as CreateCommandImpl } from './create.js';
import type { IQuestionService } from '../../questions/question-service.js';

type Params = z.infer<typeof CreateICommand.schema>;

export class CreateICommand implements ICommand<Params, void> {
  static readonly schema = z.object({
    type: z.string().describe('Entity type to create: agent | skill'),
    name: z.string().optional().describe('Name'),
    role: z.string().optional().describe('Role name'),
    interactive: z.boolean().optional().describe('Interactive mode'),
  });

  readonly key = 'create';
  readonly cli = { command: 'create <type>' };
  readonly description = 'Create a new entity (agent or skill)';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'hr';
  readonly parameters = CreateICommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly skills: ISkillManager,
    private readonly questionService: IQuestionService
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new CreateCommandImpl(this.agents, this.skills);
    const context: InteractionContext = {
      signal: ctx.signal,
      emit: ctx.emit,
      workflowState: ctx.workflowState as InteractionContext['workflowState'],
      onWorkflowFrame: ctx.onWorkflowFrame,
      questionInput: (request) => this.questionService.input(request),
      questionConfirm: (request) => this.questionService.confirm(request),
      questionSelect: (request) => this.questionService.select(request),
      questionPassword: (request) => this.questionService.password(request),
      questionChecklist: (request) => this.questionService.checklist(request),
    };

    const { type, ...options } = payload;
    await cmd.execute(type, options, context);
    return { status: 'ok' };
  }
}
