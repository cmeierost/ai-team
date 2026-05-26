import type { ChatMessage } from '@ai-team/core';
import type { IEmitService } from '../../orchestrator/services/emit-service.js';
import type { SessionManager } from '../../session-manager.js';

export interface LoadSessionMessagesParams {
  sessionId: string;
  reason: 'startup' | 'back-nav';
}

export class LoadSessionMessagesCommand {
  constructor(
    private readonly sessionManager: Pick<SessionManager, 'getSessionMessages'>,
    private readonly emitService: IEmitService
  ) {}

  async execute(params: LoadSessionMessagesParams): Promise<ChatMessage[]> {
    const { sessionId, reason } = params;
    const startedAt = Date.now();
    const messages = await this.sessionManager.getSessionMessages(sessionId);
    const elapsedMs = Date.now() - startedAt;
    this.emitService.log(
      'info',
      `[perf] loaded ${messages.length} message(s) for session ${sessionId} in ${elapsedMs}ms (${reason})`
    );
    return messages;
  }
}
