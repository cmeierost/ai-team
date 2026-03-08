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
import type { OrchestratorContext } from '../pipeline-context.js';

export class DefaultOutputHandler implements IOutputHandler {
  async handle(result: TurnResult, ctx: OrchestratorContext): Promise<void> {
    // NOTE: Message persistence is handled by send-turn.ts (step 1 for user,
    // step 8 for agent reply). This handler only emits completion events.
    // Do NOT persist here — doing so would cause duplicate DB writes.

    // Emit completion status (handoff events are emitted by executeHandoff)
    if (ctx.hooks.emit && !result.handedOff) {
      ctx.hooks.emit({ kind: 'status', phase: 'complete' });
    }
  }
}
