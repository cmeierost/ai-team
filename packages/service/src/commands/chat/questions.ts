/**
 * Question I/O helpers — prompt the developer for input or selection.
 *
 * Used exclusively by the CLI chat loop for the interactive prompt and
 * agent disambiguation. NOT for com_ask-style user questions (those are
 * now inline notation rendered client-side).
 */
import type { ChatRuntimeHooks } from './hooks.js';
import type { QuestionInputRequest, QuestionSelectRequest } from '@ai-team/api-client';

// ── Public question helpers ───────────────────────────────────────────────────

export async function requestInput(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionInputRequest
): Promise<string> {
  if (!hooks?.questionInput) {
    throw new Error('Input question requested but no client questionInput responder is available.');
  }
  await new Promise<void>((r) => setImmediate(r));
  return hooks.questionInput(request);
}

export async function requestSelect(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionSelectRequest
): Promise<string> {
  if (!hooks?.questionSelect) {
    // Fallback: render choices as numbered list via questionInput
    if (hooks?.questionInput) {
      const choiceLines = request.choices.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
      await Promise.resolve();
      const answer = await hooks.questionInput({
        message: `${request.message}\n${choiceLines}\nEnter number or option value:`,
        validate: (v) =>
          resolveSelectAnswer(v, request.choices) != null || 'Please enter a valid option.',
      });
      const resolved = resolveSelectAnswer(answer, request.choices);
      if (!resolved) throw new Error('Invalid selection for select question.');
      return resolved;
    }
    throw new Error(
      'Select question requested but no client questionSelect responder is available.'
    );
  }
  await new Promise<void>((r) => setImmediate(r));
  return hooks.questionSelect(request);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function resolveSelectAnswer(
  input: string,
  choices: Array<{ name: string; value: string }>
): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1].value;
  }

  return (
    choices.find((c) => c.value.toLowerCase() === trimmed.toLowerCase())?.value ??
    choices.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())?.value
  );
}
