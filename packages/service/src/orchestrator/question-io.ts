/**
 * question-io.ts — Surface-agnostic interactive question helpers.
 *
 * All functions accept ChatRuntimeHooks so they work identically in the
 * CLI (readline), VS Code (webview messages), and API (WebSocket) surfaces.
 *
 * Workflow replay: if hooks.workflowState contains a pre-recorded answer for
 * this question key, it is returned immediately without prompting the user.
 */

import type { ChatRuntimeHooks } from '../contracts.js';
import type {
  QuestionInputRequest,
  QuestionConfirmRequest,
  QuestionSelectRequest,
  QuestionPasswordRequest,
  QuestionChecklistRequest,
} from '../contracts.js';
import { emitEvent } from './stream-events.js';

// ── Workflow replay helper ────────────────────────────────────────────────────

function resolveWorkflowAnswer<T>(
  hooks: ChatRuntimeHooks | undefined,
  request: { workflow?: { stepId?: string; questionId?: string } },
): T | undefined {
  const key = request.workflow?.stepId ?? request.workflow?.questionId;
  if (!key || !hooks?.workflowState) return undefined;
  const value = hooks.workflowState.answers?.[key];
  return value !== undefined ? (value as T) : undefined;
}

function emitWorkflowFrame(
  hooks: ChatRuntimeHooks | undefined,
  frame: object,
): void {
  hooks?.onWorkflowFrame?.(frame as import('../contracts.js').WorkflowFrame);
}

// ── Tick helper — drains pending log events before prompting ─────────────────

/** Give the stream consumer a full event-loop tick before writing a prompt. */
const tick = () => new Promise<void>(r => setImmediate(r));

// ── Public API ────────────────────────────────────────────────────────────────

export async function requestInput(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionInputRequest,
): Promise<string> {
  emitWorkflowFrame(hooks, { kind: 'input', ...request });
  emitEvent(hooks, { kind: 'question', questionType: 'input', message: request.message });

  const resumed = resolveWorkflowAnswer<string>(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowFrame(hooks, { kind: 'result', request, answer: resumed });
    return resumed;
  }

  if (!hooks?.questionInput) {
    throw new Error('Input question requested but no questionInput responder is registered.');
  }

  await tick();
  const answer = await hooks.questionInput(request);
  emitWorkflowFrame(hooks, { kind: 'result', request, answer });
  return answer;
}

export async function requestConfirm(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionConfirmRequest,
): Promise<boolean> {
  emitWorkflowFrame(hooks, { kind: 'confirm', ...request });
  emitEvent(hooks, { kind: 'question', questionType: 'confirm', message: request.message });

  const resumed = resolveWorkflowAnswer<boolean>(hooks, request);
  if (typeof resumed === 'boolean') {
    emitWorkflowFrame(hooks, { kind: 'result', request, answer: resumed });
    return resumed;
  }

  if (!hooks?.questionConfirm) {
    throw new Error('Confirm question requested but no questionConfirm responder is registered.');
  }

  await tick();
  const answer = await hooks.questionConfirm(request);
  emitWorkflowFrame(hooks, { kind: 'result', request, answer });
  return answer;
}

export async function requestSelect(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionSelectRequest,
): Promise<string> {
  emitWorkflowFrame(hooks, { kind: 'select', ...request });
  emitEvent(hooks, {
    kind: 'question',
    questionType: 'select',
    message: request.message,
    choices: request.choices,
  });

  const resumed = resolveWorkflowAnswer<string>(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowFrame(hooks, { kind: 'result', request, answer: resumed });
    return resumed;
  }

  // Fallback: if surface has questionInput but not questionSelect, render as numbered list
  if (!hooks?.questionSelect && hooks?.questionInput) {
    const choiceLines = request.choices
      .map((c, i) => `${i + 1}. ${c.name}`)
      .join('\n');

    await tick();
    const raw = await hooks.questionInput({
      message: `${request.message}\n${choiceLines}\nEnter number or option:`,
      workflow: request.workflow,
      validate: v => resolveSelectAnswer(v, request.choices) != null || 'Please enter a valid option.',
    });

    const resolved = resolveSelectAnswer(raw, request.choices);
    if (!resolved) throw new Error('Invalid selection for select question.');
    emitWorkflowFrame(hooks, { kind: 'result', request, answer: resolved });
    return resolved;
  }

  if (!hooks?.questionSelect) {
    throw new Error('Select question requested but no questionSelect responder is registered.');
  }

  await tick();
  const answer = await hooks.questionSelect(request);
  emitWorkflowFrame(hooks, { kind: 'result', request, answer });
  return answer;
}

export async function requestPassword(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionPasswordRequest,
): Promise<string> {
  emitWorkflowFrame(hooks, { kind: 'password', ...request });
  emitEvent(hooks, { kind: 'question', questionType: 'password', message: request.message });

  const resumed = resolveWorkflowAnswer<string>(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowFrame(hooks, { kind: 'result', request, answer: resumed });
    return resumed;
  }

  if (!hooks?.questionPassword) {
    throw new Error('Password question requested but no questionPassword responder is registered.');
  }

  await tick();
  const answer = await hooks.questionPassword(request);
  emitWorkflowFrame(hooks, { kind: 'result', request, answer });
  return answer;
}

export async function requestChecklist(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionChecklistRequest,
): Promise<string[]> {
  emitWorkflowFrame(hooks, { kind: 'checklist', ...request });
  emitEvent(hooks, {
    kind: 'question',
    questionType: 'checklist',
    message: request.message,
    choices: request.choices,
  });

  const resumed = resolveWorkflowAnswer<string[]>(hooks, request);
  if (Array.isArray(resumed) && resumed.every(i => typeof i === 'string')) {
    emitWorkflowFrame(hooks, { kind: 'result', request, answer: resumed });
    return resumed;
  }

  if (!hooks?.questionChecklist) {
    throw new Error('Checklist question requested but no questionChecklist responder is registered.');
  }

  await tick();
  const answer = await hooks.questionChecklist(request);
  emitWorkflowFrame(hooks, { kind: 'result', request, answer });
  return answer;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function resolveSelectAnswer(
  input: string,
  choices: Array<{ name: string; value: string }>,
): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const n = parseInt(trimmed, 10);
  if (!isNaN(n) && n >= 1 && n <= choices.length) return choices[n - 1].value;

  return (
    choices.find(c => c.value.toLowerCase() === trimmed.toLowerCase())?.value ??
    choices.find(c => c.name.toLowerCase() === trimmed.toLowerCase())?.value
  );
}
