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
    private readonly skills: ISkillManager
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new CreateCommandImpl(this.agents, this.skills);
    const context: InteractionContext = {
      signal: ctx.signal,
      emit: ctx.emit as InteractionContext['emit'],
      questionInput: ctx.questionInput,
      questionConfirm: ctx.questionConfirm,
      questionSelect: ctx.questionSelect,
      questionPassword: ctx.questionPassword,
      questionChecklist: ctx.questionChecklist,
    };
    const { type, ...options } = payload;
    await cmd.execute(type, options, context);
    return { status: 'ok' };
  }
}
