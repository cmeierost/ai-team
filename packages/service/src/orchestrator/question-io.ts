/**
 * question-io.ts — Surface-agnostic confirm helper.
 *
 * Used exclusively for tool-execution approval and slash-command confirmation,
 * NOT for com_ask-style user questions (those are now inline notation).
 */

import type { ChatRuntimeHooks, QuestionConfirmRequest } from '../contracts.js';

// ── Tick helper — drains pending log events before prompting ─────────────────

/** Give the stream consumer a full event-loop tick before writing a prompt. */
const tick = () => new Promise<void>(r => setImmediate(r));

// ── Public API ────────────────────────────────────────────────────────────────

export async function requestConfirm(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionConfirmRequest,
): Promise<boolean> {
  if (!hooks?.questionConfirm) {
    throw new Error('Confirm question requested but no questionConfirm responder is registered.');
  }

  await tick();
  return hooks.questionConfirm(request);
}
