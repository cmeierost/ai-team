/**
 * Question I/O helpers — prompt the developer for input or selection.
 */
import type { ChatRuntimeHooks } from '../../orchestrator/hooks.js';
import type { QuestionInputRequest, QuestionSelectRequest } from '@ai-team/api-contracts';

type InputWithValidate = QuestionInputRequest & {
  validate?: (value: string) => true | string;
};

export async function requestInput(
  hooks: ChatRuntimeHooks | undefined,
  request: InputWithValidate
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
    if (hooks?.questionInput) {
      const choiceLines = request.choices.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
      await Promise.resolve();
      const answer = await hooks.questionInput({
        message: `${request.message}\n${choiceLines}\nEnter number or option value:`,
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
