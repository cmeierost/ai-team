import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  IServiceContainer,
} from '@ai-team/core';
import { ChatCommand } from './chat.command.js';
import { COMMAND_FACTORY_TOKENS } from '../../types.js';

type Params = z.infer<typeof ChatICommand.schema>;
const _chatICommandSchema = z.object({
  employeeId: z.string().optional().describe('Agent id, name, or role query'),
  options: z
    .object({
      message: z.string().optional(),
      context: z.array(z.string()).optional(),
      mediatorLog: z.boolean().optional(),
      new: z.boolean().optional(),
      createNewSession: z.boolean().optional(),
      sessionId: z.string().optional(),
    })
    .optional()
    .default({}),
});

export const ChatCommandMetadata = {
  key: 'chat' as const,
  description: 'Start a chat session with an agent',
  availableIn: { cli: true, chat: false, tool: false },
  group: 'chat',
  parameters: _chatICommandSchema,
} satisfies ICommandDescriptor;

export class ChatICommand implements ICommand<Params, void> {
  static readonly schema = _chatICommandSchema;
  readonly metadata = ChatCommandMetadata;

  constructor(private readonly serviceContainer: IServiceContainer) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    let { employeeId } = payload;
    const rawOptions = payload.options ?? {};
    const createNewSession = rawOptions.createNewSession ?? rawOptions.new;
    const options: typeof rawOptions & { createNewSession?: boolean } = {
      ...rawOptions,
      createNewSession,
    };

    // When no agent is specified and no session is pinned, jump back to the
    // most recently active session regardless of which agent it belongs to.
    if (!employeeId && !options.sessionId && !createNewSession) {
      const sessionManager = this.serviceContainer.resolve(COMMAND_FACTORY_TOKENS.SessionManager);
      const recent = await sessionManager.listRecentSessions(1);
      if (recent.length > 0) {
        const last = recent[0];
        employeeId = last.agentId;
        options.sessionId = last.id;
      }
    }

    const runtimeCtx = ctx as unknown as {
      workspaceRoot: string;
      invocationSurface?: ExecutionContext['invocationSurface'];
      signal?: AbortSignal;
      workflowState?: unknown;
      onWorkflowFrame?: ExecutionContext['onWorkflowFrame'];
    };
    const hooks = {
      invocationSurface: runtimeCtx.invocationSurface,
      signal: runtimeCtx.signal,
      workflowState: runtimeCtx.workflowState as
        | import('@ai-team/api-contracts').WorkflowStateSnapshot
        | undefined,
      onWorkflowFrame: runtimeCtx.onWorkflowFrame,
    };

    const cmd = this.resolveChatCommand();
    await cmd.execute(runtimeCtx.workspaceRoot, employeeId, options, hooks);
    return { status: 'ok' };
  }

  private resolveChatCommand(): ChatCommand {
    return new ChatCommand(this.serviceContainer);
  }
}
