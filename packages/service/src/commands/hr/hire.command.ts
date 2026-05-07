import { z } from 'zod';
import type {
  ICommand,
  CommandRuntime,
  IAgentManager,
  IMarkdownSectionService,
} from '@ai-team/core';
import type { InteractionContext } from '@ai-team/api-contracts';
import { HireCommand as HireCommandImpl } from './hire.js';

type Params = z.infer<typeof HireICommand.schema>;

export class HireICommand implements ICommand<Params, void, void> {
  static readonly schema = z.object({
    name: z.string().optional().describe('Employee name'),
    role: z.string().optional().describe('Unique role name'),
    skill: z.string().optional().describe('Skill from catalog'),
    type: z.string().optional().describe('Role type'),
    reportsTo: z.string().optional().describe('Manager employee ID'),
    chat: z.boolean().optional().describe('Run onboarding chat phase'),
  });

  readonly key = 'hire';
  readonly cli = { command: 'hire' };
  readonly description = 'Hire a new team member';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly parameters = HireICommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly markdown: IMarkdownSectionService
  ) {}

  async execute(payload: Params, _ctx: void, runtime: CommandRuntime): Promise<void> {
    const cmd = new HireCommandImpl(this.agents, this.markdown);
    const context: InteractionContext = {
      signal: runtime.signal,
      emit: runtime.emit as InteractionContext['emit'],
      questionInput: runtime.questionInput,
      questionConfirm: runtime.questionConfirm,
      questionSelect: runtime.questionSelect,
      questionPassword: runtime.questionPassword,
      questionChecklist: runtime.questionChecklist,
    };
    return cmd.execute(payload, context);
  }
}
