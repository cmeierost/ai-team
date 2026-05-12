import type { ExecutionContext } from '@ai-team/core';
/**
 * DefaultOutputHandler — default IOutputHandler.
 *
 * After each completed LLM turn, emits a 'status' runtime event via hooks.emit.
 *
 * Message persistence is handled by send-turn.ts (step 1 for user message,
 * step 8 for agent reply). This handler does NOT persist messages to avoid
 * duplicate DB writes.
 */

import type { IOutputHandler, TurnResult } from '../pipeline.js';

export class DefaultOutputHandler implements IOutputHandler {
  async handle(result: TurnResult, ctx: ExecutionContext): Promise<void> {
    // NOTE: Message persistence is handled by send-turn.ts (step 1 for user,
    // step 8 for agent reply). This handler only emits completion events.
    // Do NOT persist here — doing so would cause duplicate DB writes.

    // Emit completion status (handoff events are emitted by executeHandoff)
    if (((ctx as any).hooks).emit && !result.handedOff) {
      ((ctx as any).hooks).emit({ kind: 'status', phase: 'complete' });
    }
  }
}
