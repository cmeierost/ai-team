import type {
  ICommand,
  CommandResponse,
  IDeveloperIdentityService,
  ExecutionContext,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SessionManager } from '../../session-manager.js';
import { emitRuntimeEvent } from '../../orchestrator/chat-emitter.js';
export const NewSessionChatCommandMetadata = {
  key: 'new',
  description: 'Start a new session with the current agent',
  availableIn: { chat: true, tool: false },
  group: 'session',
} satisfies ICommandDescriptor;

export class NewSessionChatCommand implements ICommand<string, string> {
  readonly metadata = NewSessionChatCommandMetadata;

  constructor(
    private readonly developerIdentityService: IDeveloperIdentityService,
    private readonly sessionManager: Pick<SessionManager, 'createSession'>
  ) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const developerId = this.developerIdentityService.toDeveloperId('developer');
    const fresh = await this.sessionManager.createSession(ctx.agent!.id, developerId);
    ctx.sessionId = fresh.id;
    ctx.history = [];
    emitRuntimeEvent(ctx, { kind: 'session_switched', sessionId: fresh.id });
    const message = `New session started: ${fresh.id}`;
    return { status: 'ok', message, data: fresh.id };
  }
}
