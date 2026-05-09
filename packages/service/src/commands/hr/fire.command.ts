import { z } from 'zod';
import type { ICommand, CommandRuntime, IAgentManager } from '@ai-team/core';
import type { InteractionContext } from '@ai-team/api-contracts';
import { FireCommand as FireCommandImpl } from './fire.js';

type Params = z.infer<typeof FireICommand.schema>;

export class FireICommand implements ICommand<Params, void, void> {
  static readonly schema = z.object({
    employeeQuery: z.string().describe('Agent id, name, or role query'),
    options: z.object({
      force: z.boolean().optional().describe('Do not prompt for confirmation'),
    }).optional().default({}),
  });

  readonly key = 'fire';
  readonly cli = { command: 'fire <agent>' };
  readonly description = 'Fire (delete) an employee and remove their data';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'hr';
  readonly parameters = FireICommand.schema;

  constructor(private readonly agents: IAgentManager) {}

  async execute(payload: Params, _ctx: void, runtime: CommandRuntime): Promise<void> {
    const cmd = new FireCommandImpl(this.agents);
    const context: InteractionContext = {
      signal: runtime.signal,
      emit: runtime.emit as InteractionContext['emit'],
      questionConfirm: runtime.questionConfirm,
    };
    return cmd.execute(payload.employeeQuery, { force: payload.options?.force }, context);
  }
}
