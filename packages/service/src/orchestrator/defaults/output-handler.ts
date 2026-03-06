/**
 * DefaultOutputHandler — default IOutputHandler.
 *
 * After each completed LLM turn:
 *  1. Persists the assistant message to SessionManager (SQLite).
 *  2. Emits a 'status' runtime event via hooks.emit if connected.
 */

import type { ChatMessage } from '@ai-team/core';
import type { MediatorRuntimeEvent } from '../../contracts.js';
import type { IOutputHandler, TurnResult } from '../pipeline.js';
import type { OrchestratorContext } from '../pipeline-context.js';

export class DefaultOutputHandler implements IOutputHandler {
  async handle(result: TurnResult, ctx: OrchestratorContext): Promise<void> {
    // 1. Persist assistant reply to session history
    if (result.text) {
      const message: ChatMessage = {
        from: ctx.agent.id,
        content: result.text,
        timestamp: new Date().toISOString(),
        isHuman: false,
      };
      await ctx.sessionManager.appendMessage(ctx.sessionId, message);
    }

    // 2. Emit runtime event if the surface is listening
    if (ctx.hooks.emit) {
      const event: MediatorRuntimeEvent = result.handedOff
        ? {
            kind: 'handoff',
            fromAgentId: ctx.agent.id,
            toAgentId: result.handoffTargetId,
          }
        : {
            kind: 'status',
            phase: 'complete',
          };
      ctx.hooks.emit(event);
    }
  }
}
