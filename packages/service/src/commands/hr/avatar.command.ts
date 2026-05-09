import { z } from 'zod';
import type {
  ICommand,
  CommandRuntime,
} from '@ai-team/core';
import type { InteractionContext } from '@ai-team/api-contracts';
import { AvatarService } from './avatar.js';

type Params = z.infer<typeof AvatarCommand.schema>;

export class AvatarCommand implements ICommand<Params, void, void> {
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

  async execute(payload: Params, _ctx: void, runtime: CommandRuntime): Promise<void> {
    const context: InteractionContext = {
      signal: runtime.signal,
      emit: runtime.emit as InteractionContext['emit'],
      questionInput: runtime.questionInput,
      questionConfirm: runtime.questionConfirm,
      questionSelect: runtime.questionSelect,
      questionPassword: runtime.questionPassword,
      questionChecklist: runtime.questionChecklist,
      workflowState: runtime.workflowState,
      onWorkflowFrame: runtime.onWorkflowFrame,
    };

    return this.avatarService.execute(payload.options, context);
  }
}
