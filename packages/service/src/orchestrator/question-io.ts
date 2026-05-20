/**
 * question-io.ts — Surface-agnostic confirm helper.
 *
 * Used exclusively for tool-execution approval and slash-command confirmation,
 * NOT for com_ask-style user questions (those are now inline notation).
 */

import type { QuestionConfirmRequest } from '@ai-team/api-contracts';
import type { IQuestionService } from '../questions/question-service.js';

// ── Tick helper — drains pending log events before prompting ─────────────────

/** Give the stream consumer a full event-loop tick before writing a prompt. */
const tick = () => new Promise<void>((r) => setImmediate(r));

// ── Public API ────────────────────────────────────────────────────────────────

export async function requestConfirm(
  questionService: IQuestionService,
  request: QuestionConfirmRequest
): Promise<boolean> {
  await tick();
  return questionService.confirm(request);
}
