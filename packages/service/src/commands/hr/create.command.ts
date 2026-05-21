import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ISkillManager,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import { CreateCommand as CreateCommandImpl } from './create.js';
import type { IInteractionService } from '../../questions/question-service.js';

type Params = z.infer<typeof CreateICommand.schema>;
const _createICommandSchema = z.object({
  type: z.string().describe('Entity type to create: agent | skill'),
  name: z.string().optional().describe('Name'),
  role: z.string().optional().describe('Role name'),
  interactive: z.boolean().optional().describe('Interactive mode'),
});

export const CreateICommandMetadata = {
  key: 'create',
  cli: { command: 'create <type>' },
  description: 'Create a new entity (agent or skill)',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'hr',
  parameters: _createICommandSchema,
} satisfies ICommandDescriptor;

export class CreateICommand implements ICommand<Params, void> {
  static readonly schema = _createICommandSchema;
  readonly metadata = CreateICommandMetadata;

  constructor(
    private readonly agents: IAgentManager,
    private readonly skills: ISkillManager,
    private readonly interactionService: IInteractionService
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new CreateCommandImpl(this.agents, this.skills, this.interactionService);
    const { type, ...options } = payload;
    await cmd.execute(type, options);
    return { status: 'ok' };
  }
}
