import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  IMarkdownSectionService,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import { HireCommand as HireCommandImpl } from './hire.js';
import type { IEmitService } from '@ai-team/core';

type Params = z.infer<typeof HireICommand.schema>;
const _hireICommandSchema = z.object({
  name: z.string().optional().describe('Employee name'),
  role: z.string().optional().describe('Unique role name'),
  skill: z.string().optional().describe('Skill from catalog'),
  type: z.string().optional().describe('Role type'),
  reportsTo: z.string().optional().describe('Manager employee ID'),
  chat: z.boolean().optional().describe('Run onboarding chat phase'),
});

export const HireICommandMetadata = {
  key: 'hire',
  description: 'Hire a new team member',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'hr',
  parameters: _hireICommandSchema,
} satisfies ICommandDescriptor;

export class HireICommand implements ICommand<Params, void> {
  static readonly schema = _hireICommandSchema;
  readonly metadata = HireICommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly agents: IAgentManager,
    private readonly markdown: IMarkdownSectionService,
    private readonly emitService: IEmitService
  ) {}

  async execute(payload: Params, _ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new HireCommandImpl(
      this.workspaceRoot,
      this.agents,
      this.markdown,
      this.emitService
    );
    await cmd.execute(payload);
    return { status: 'ok' };
  }
}
