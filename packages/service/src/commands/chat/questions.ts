/**
 * Question I/O helpers — prompt the developer for input, confirmation, selection,
 * password, or checklist answers. All questions flow through ChatRuntimeHooks so
 * the same logic works in the CLI, VS Code extension, and API server.
 *
 * Also handles workflow replay (pre-populated answers) and the workflow-frame
 * callbacks that let multi-step UIs track question/answer pairs.
 */
import type { ChatRuntimeHooks } from './hooks.js';
import { emitRuntimeEvent } from './emit.js';
import type {
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '../../contracts.js';

// ── Workflow frame helpers ────────────────────────────────────────────────────

function resolveWorkflowAnswer(
  hooks: ChatRuntimeHooks | undefined,
  request: { workflow?: { workflowId?: string; questionId?: string } },
): QuestionAnswerValue | undefined {
  const workflowId = request.workflow?.workflowId;
  const questionId = request.workflow?.questionId;
  if (!workflowId || !questionId) return undefined;
  if (hooks?.workflowState?.workflowId !== workflowId) return undefined;
  return hooks.workflowState.answers[questionId];
}

function emitWorkflowQuestionFrame(
  hooks: ChatRuntimeHooks | undefined,
  request:
    | ({ kind: 'input' } & QuestionInputRequest)
    | ({ kind: 'confirm' } & QuestionConfirmRequest)
    | ({ kind: 'select' } & QuestionSelectRequest)
    | ({ kind: 'password' } & QuestionPasswordRequest)
    | ({ kind: 'checklist' } & QuestionChecklistRequest),
): void {
  const workflowId = request.workflow?.workflowId;
  if (!workflowId) return;
  hooks?.onWorkflowFrame?.({
    workflowId,
    stepId: request.workflow?.stepId || 'question',
    continuationToken: request.workflow?.continuationToken,
    question: request,
  });
}

function emitWorkflowResultFrame(
  hooks: ChatRuntimeHooks | undefined,
  request: { workflow?: { workflowId?: string; stepId?: string; continuationToken?: string; questionId?: string } },
  result: QuestionAnswerValue,
): void {
  const workflowId = request.workflow?.workflowId;
  if (!workflowId) return;
  hooks?.onWorkflowFrame?.({
    workflowId,
    stepId: request.workflow?.stepId || 'question',
    continuationToken: request.workflow?.continuationToken,
    question: request.workflow?.questionId
      ? { kind: 'input', message: '', workflow: request.workflow }
      : undefined,
    result,
  });
}

// ── Select answer resolution ──────────────────────────────────────────────────

function resolveSelectAnswer(
  input: string,
  choices: Array<{ name: string; value: string }>,
): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1].value;
  }

  const byValue = choices.find(c => c.value.toLowerCase() === trimmed.toLowerCase());
  if (byValue) return byValue.value;

  const byName = choices.find(c => c.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) return byName.value;

  return undefined;
}

// ── Public question helpers ───────────────────────────────────────────────────

export async function requestInput(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionInputRequest,
): Promise<string> {
  emitWorkflowQuestionFrame(hooks, { kind: 'input', ...request });
  emitRuntimeEvent(hooks, { kind: 'question', questionType: 'input', message: request.message });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') { emitWorkflowResultFrame(hooks, request, resumed); return resumed; }

  if (!hooks?.questionInput) {
    throw new Error('Input question requested but no client questionInput responder is available.');
  }
  // Give the stream consumer a full event-loop tick to drain pending log events
  // before readline writes the prompt synchronously.
  await new Promise<void>(r => setImmediate(r));
  const answer = await hooks.questionInput!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

export async function requestConfirm(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionConfirmRequest,
): Promise<boolean> {
  emitWorkflowQuestionFrame(hooks, { kind: 'confirm', ...request });
  emitRuntimeEvent(hooks, { kind: 'question', questionType: 'confirm', message: request.message });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'boolean') { emitWorkflowResultFrame(hooks, request, resumed); return resumed; }

  if (!hooks?.questionConfirm) {
    throw new Error('Confirm question requested but no client questionConfirm responder is available.');
  }
  await new Promise<void>(r => setImmediate(r));
  const answer = await hooks.questionConfirm!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

export async function requestSelect(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionSelectRequest,
): Promise<string> {
  emitWorkflowQuestionFrame(hooks, { kind: 'select', ...request });
  emitRuntimeEvent(hooks, {
    kind: 'question',
    questionType: 'select',
    message: request.message,
    choices: request.choices,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') { emitWorkflowResultFrame(hooks, request, resumed); return resumed; }

  if (!hooks?.questionSelect) {
    // Fallback: render choices as numbered list via questionInput
    if (hooks?.questionInput) {
      const choiceLines = request.choices.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
      await Promise.resolve();
      const answer = await hooks.questionInput!({
        message: `${request.message}\n${choiceLines}\nEnter number or option value:`,
        workflow: request.workflow,
        validate: (value: string) => {
          const resolved = resolveSelectAnswer(value, request.choices);
          return resolved ? true : 'Please enter a valid option number, name, or value.';
        },
      });
      const resolved = resolveSelectAnswer(answer, request.choices);
      if (!resolved) throw new Error('Invalid selection answer for select question.');
      emitWorkflowResultFrame(hooks, request, resolved);
      return resolved;
    }
    throw new Error(
      'Select question requested but no client questionSelect or compatible questionInput responder is available.',
    );
  }

  await Promise.resolve();
  const answer = await hooks.questionSelect!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

export async function requestPassword(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionPasswordRequest,
): Promise<string> {
  emitWorkflowQuestionFrame(hooks, { kind: 'password', ...request });
  emitRuntimeEvent(hooks, { kind: 'question', questionType: 'password', message: request.message });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') { emitWorkflowResultFrame(hooks, request, resumed); return resumed; }

  if (!hooks?.questionPassword) {
    throw new Error('Password question requested but no client questionPassword responder is available.');
  }
  await Promise.resolve();
  const answer = await hooks.questionPassword!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

export async function requestChecklist(
  hooks: ChatRuntimeHooks | undefined,
  request: QuestionChecklistRequest,
): Promise<string[]> {
  emitWorkflowQuestionFrame(hooks, { kind: 'checklist', ...request });
  emitRuntimeEvent(hooks, {
    kind: 'question',
    questionType: 'checklist',
    message: request.message,
    choices: request.choices,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (Array.isArray(resumed) && resumed.every(item => typeof item === 'string')) {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionChecklist) {
    throw new Error('Checklist question requested but no client questionChecklist responder is available.');
  }
  await Promise.resolve();
  const answer = await hooks.questionChecklist!(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}
