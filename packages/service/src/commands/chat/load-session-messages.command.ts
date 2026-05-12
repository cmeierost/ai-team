import type { ChatMessage } from '@ai-team/core';
import { writeInfo } from '../../orchestrator/chat-emitter.js';
import type { EmitSink } from '../../orchestrator/chat-emitter.js';
import type { SessionManager } from '../../session-manager.js';

export interface LoadSessionMessagesParams {
  sessionId: string;
  reason: 'startup' | 'back-nav';
  sink?: EmitSink;
}

export class LoadSessionMessagesCommand {
  constructor(
    private readonly sessionManager: Pick<SessionManager, 'getSessionMessages'>
  ) {}

  async execute(params: LoadSessionMessagesParams): Promise<ChatMessage[]> {
    const { sessionId, reason, sink } = params;
    const startedAt = Date.now();
    const messages = await this.sessionManager.getSessionMessages(sessionId);
    const elapsedMs = Date.now() - startedAt;
    writeInfo(
      sink,
      `[perf] loaded ${messages.length} message(s) for session ${sessionId} in ${elapsedMs}ms (${reason})`
    );
    return messages;
  }
}
