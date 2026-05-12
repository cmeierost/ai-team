import { z } from 'zod';
import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { InteractionContext } from '@ai-team/api-contracts';
import { AvatarService } from './avatar.js';

type Params = z.infer<typeof AvatarCommand.schema>;

export class AvatarCommand implements ICommand<Params, void> {
  static readonly schema = z.object({
    options: z.object({
      agentQuery: z.string().describe('Agent id, name, or role query for avatar setup'),
    }),
  });

  readonly key = 'avatar';
  readonly cli = { command: 'avatar <agentQuery>' };
  readonly description = 'Generate or select an avatar image for an agent';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'hr';
  readonly parameters = AvatarCommand.schema;

  constructor(private readonly avatarService: AvatarService) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const context: InteractionContext = {
      signal: ctx.signal,
      emit: ctx.emit as InteractionContext['emit'],
      questionInput: ctx.questionInput,
      questionConfirm: ctx.questionConfirm,
      questionSelect: ctx.questionSelect,
      questionPassword: ctx.questionPassword,
      questionChecklist: ctx.questionChecklist,
      workflowState: ctx.workflowState as InteractionContext['workflowState'],
      onWorkflowFrame: ctx.onWorkflowFrame,
    };

    await this.avatarService.execute(payload.options, context);
    return { status: 'ok' };
  }
}
