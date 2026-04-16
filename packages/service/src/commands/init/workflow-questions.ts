import type {
  RuntimeStreamEvent,
  QuestionAnswerValue,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
  WorkflowFrame,
  WorkflowStateSnapshot,
} from '@ai-team/api-client';
import {
  resolveWorkflowAnswer as _resolveWorkflowAnswer,
  emitWorkflowQuestionFrame as _emitWorkflowQuestionFrame,
  emitWorkflowResultFrame as _emitWorkflowResultFrame,
  ensureNotAborted as _ensureNotAborted,
} from '../../workflow/helpers.js';

export interface InitRuntimeHooks {
  signal?: AbortSignal;
  emit?: (event: RuntimeStreamEvent) => void;
  questionInput?: (request: QuestionInputRequest) => Promise<string>;
  questionConfirm?: (request: QuestionConfirmRequest) => Promise<boolean>;
  questionSelect?: (request: QuestionSelectRequest) => Promise<string>;
  questionPassword?: (request: QuestionPasswordRequest) => Promise<string>;
  questionChecklist?: (request: QuestionChecklistRequest) => Promise<string[]>;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
}

// Thin wrappers that delegate to the shared workflow helpers.
// InitRuntimeHooks is structurally compatible with InteractionContext.

function resolveWorkflowAnswer(
  hooks: InitRuntimeHooks | undefined,
  request: { workflow?: { workflowId?: string; questionId?: string } }
): QuestionAnswerValue | undefined {
  return _resolveWorkflowAnswer(hooks, request);
}

function emitWorkflowQuestionFrame(
  hooks: InitRuntimeHooks | undefined,
  request:
    | ({ kind: 'input' } & QuestionInputRequest)
    | ({ kind: 'confirm' } & QuestionConfirmRequest)
    | ({ kind: 'select' } & QuestionSelectRequest)
    | ({ kind: 'password' } & QuestionPasswordRequest)
    | ({ kind: 'checklist' } & QuestionChecklistRequest)
): void {
  _emitWorkflowQuestionFrame(hooks, request);
}

function emitWorkflowResultFrame(
  hooks: InitRuntimeHooks | undefined,
  request: {
    workflow?: {
      workflowId?: string;
      stepId?: string;
      continuationToken?: string;
      questionId?: string;
    };
  },
  result: QuestionAnswerValue
): void {
  _emitWorkflowResultFrame(hooks, request, result);
}

function ensureNotAborted(hooks: InitRuntimeHooks | undefined): void {
  _ensureNotAborted(hooks);
}

function resolveSelectAnswer(
  input: string,
  choices: Array<{ name: string; value: string }>
): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1].value;
  }

  const exactValue = choices.find((choice) => choice.value.toLowerCase() === trimmed.toLowerCase());
  if (exactValue) {
    return exactValue.value;
  }

  const exactName = choices.find((choice) => choice.name.toLowerCase() === trimmed.toLowerCase());
  if (exactName) {
    return exactName.value;
  }

  return undefined;
}

export async function requestInput(
  hooks: InitRuntimeHooks | undefined,
  request: QuestionInputRequest
): Promise<string> {
  ensureNotAborted(hooks);
  emitWorkflowQuestionFrame(hooks, { kind: 'input', ...request });
  hooks?.emit?.({
    kind: 'question',
    questionType: 'input',
    message: request.message,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionInput) {
    throw new Error('Input question requested but no client questionInput responder is available.');
  }
  await Promise.resolve();
  const answer = await hooks.questionInput(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

export async function requestConfirm(
  hooks: InitRuntimeHooks | undefined,
  request: QuestionConfirmRequest
): Promise<boolean> {
  ensureNotAborted(hooks);
  emitWorkflowQuestionFrame(hooks, { kind: 'confirm', ...request });
  hooks?.emit?.({
    kind: 'question',
    questionType: 'confirm',
    message: request.message,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'boolean') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionConfirm) {
    throw new Error(
      'Confirm question requested but no client questionConfirm responder is available.'
    );
  }
  await Promise.resolve();
  const answer = await hooks.questionConfirm(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

export async function requestSelect(
  hooks: InitRuntimeHooks | undefined,
  request: QuestionSelectRequest
): Promise<string> {
  ensureNotAborted(hooks);
  emitWorkflowQuestionFrame(hooks, { kind: 'select', ...request });
  hooks?.emit?.({
    kind: 'question',
    questionType: 'select',
    message: request.message,
    choices: request.choices,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionSelect) {
    if (hooks?.questionInput) {
      const choiceLines = request.choices
        .map((choice, index) => `${index + 1}. ${choice.name}`)
        .join('\n');

      await Promise.resolve();
      const answer = await hooks.questionInput({
        message: `${request.message}\n${choiceLines}\nEnter number or option value:`,
        workflow: request.workflow,
        validate: (value: string) => {
          const resolved = resolveSelectAnswer(value, request.choices);
          return resolved ? true : 'Please enter a valid option number, name, or value.';
        },
      });

      const resolved = resolveSelectAnswer(answer, request.choices);
      if (!resolved) {
        throw new Error('Invalid selection answer for select question.');
      }

      emitWorkflowResultFrame(hooks, request, resolved);
      return resolved;
    }

    throw new Error(
      'Select question requested but no client questionSelect or compatible questionInput responder is available.'
    );
  }
  await Promise.resolve();
  const answer = await hooks.questionSelect(request);
  const resolved = resolveSelectAnswer(answer, request.choices);
  if (!resolved) {
    throw new Error(
      'Select responder returned an invalid choice. Please choose one of the listed options.'
    );
  }
  emitWorkflowResultFrame(hooks, request, resolved);
  return resolved;
}

export async function requestPassword(
  hooks: InitRuntimeHooks | undefined,
  request: QuestionPasswordRequest
): Promise<string> {
  ensureNotAborted(hooks);
  emitWorkflowQuestionFrame(hooks, { kind: 'password', ...request });
  hooks?.emit?.({
    kind: 'question',
    questionType: 'password',
    message: request.message,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (!hooks?.questionPassword) {
    throw new Error(
      'Password question requested but no client questionPassword responder is available.'
    );
  }
  await Promise.resolve();
  const answer = await hooks.questionPassword(request);
  emitWorkflowResultFrame(hooks, request, answer);
  return answer;
}

function parseChecklistAnswer(
  input: string,
  choices: Array<{ name: string; value: string }>
): string[] {
  const tokens = input
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return [];
  }

  const selected = new Set<string>();

  for (const token of tokens) {
    const numeric = Number.parseInt(token, 10);
    if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= choices.length) {
      selected.add(choices[numeric - 1].value);
      continue;
    }

    const exactValue = choices.find((choice) => choice.value.toLowerCase() === token.toLowerCase());
    if (exactValue) {
      selected.add(exactValue.value);
      continue;
    }

    const exactName = choices.find((choice) => choice.name.toLowerCase() === token.toLowerCase());
    if (exactName) {
      selected.add(exactName.value);
      continue;
    }

    throw new Error(`Invalid checklist option: "${token}".`);
  }

  return Array.from(selected);
}

export async function requestChecklist(
  hooks: InitRuntimeHooks | undefined,
  request: QuestionChecklistRequest
): Promise<string[]> {
  ensureNotAborted(hooks);
  emitWorkflowQuestionFrame(hooks, { kind: 'checklist', ...request });
  hooks?.emit?.({
    kind: 'question',
    questionType: 'checklist',
    message: request.message,
    choices: request.choices,
  });

  const resumed = resolveWorkflowAnswer(hooks, request);
  if (Array.isArray(resumed) && resumed.every((value) => typeof value === 'string')) {
    emitWorkflowResultFrame(hooks, request, resumed);
    return resumed;
  }

  if (hooks?.questionChecklist) {
    await Promise.resolve();
    const answer = await hooks.questionChecklist(request);
    emitWorkflowResultFrame(hooks, request, answer);
    return answer;
  }

  if (hooks?.questionInput) {
    const choiceLines = request.choices
      .map((choice, index) => `${index + 1}. ${choice.name}`)
      .join('\n');

    await Promise.resolve();
    const answer = await hooks.questionInput({
      message: `${request.message}\n${choiceLines}\nEnter one or more values (comma-separated).`,
      workflow: request.workflow,
      validate: (value: string) => {
        try {
          parseChecklistAnswer(value, request.choices);
          return true;
        } catch {
          return 'Please enter valid option numbers, names, or values (comma-separated).';
        }
      },
    });

    const parsed = parseChecklistAnswer(answer, request.choices);
    emitWorkflowResultFrame(hooks, request, parsed);
    return parsed;
  }

  throw new Error(
    'Checklist question requested but no client questionChecklist or compatible questionInput responder is available.'
  );
}
