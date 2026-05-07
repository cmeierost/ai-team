import { z } from 'zod';
import type { ICommand, CommandRuntime, IAgentManager, ISkillManager } from '@ai-team/core';
import type { InteractionContext } from '@ai-team/api-contracts';
import { CreateCommand as CreateCommandImpl } from './create.js';

type Params = z.infer<typeof CreateICommand.schema>;

export class CreateICommand implements ICommand<Params, void, void> {
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
  readonly parameters = CreateICommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly skills: ISkillManager
  ) {}

  async execute(payload: Params, _ctx: void, runtime: CommandRuntime): Promise<void> {
    const cmd = new CreateCommandImpl(this.agents, this.skills);
    const context: InteractionContext = {
      signal: runtime.signal,
      emit: runtime.emit as InteractionContext['emit'],
      questionInput: runtime.questionInput,
      questionConfirm: runtime.questionConfirm,
      questionSelect: runtime.questionSelect,
      questionPassword: runtime.questionPassword,
      questionChecklist: runtime.questionChecklist,
    };
    const { type, ...options } = payload;
    return cmd.execute(type, options, context);
  }
}
