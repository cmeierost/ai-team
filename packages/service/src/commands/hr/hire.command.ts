import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  IMarkdownSectionService,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import { HireCommand as HireCommandImpl } from './hire.js';

type Params = z.infer<typeof HireICommand.schema>;

export class HireICommand implements ICommand<Params, void> {
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
  readonly group = 'hr';
  readonly parameters = HireICommand.schema;

  constructor(
    private readonly workspaceRoot: string,
    private readonly agents: IAgentManager,
    private readonly markdown: IMarkdownSectionService
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new HireCommandImpl(this.workspaceRoot, this.agents, this.markdown);
    await cmd.execute(payload, ctx);
    return { status: 'ok' };
  }
}
