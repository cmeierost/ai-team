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
} from '@ai-team/api-contracts';
import type { Agent, ToolContext } from '@ai-team/core';
import {
  resolveWorkflowAnswer as _resolveWorkflowAnswer,
  emitWorkflowQuestionFrame as _emitWorkflowQuestionFrame,
  emitWorkflowResultFrame as _emitWorkflowResultFrame,
  ensureNotAborted as _ensureNotAborted,
} from '../../workflow/helpers.js';
import { AskUserTool } from '../../tools/orchestration-tools.js';

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

type AskKind = 'input' | 'confirm' | 'select' | 'password' | 'checklist';

const INIT_ASK_AGENT: Agent = {
  id: 'init-system',
  name: 'Init System',
  role: 'setup orchestrator',
  type: 'executive' as Agent['type'],
  contextLevel: 'organization' as Agent['contextLevel'],
  filePath: '',
  skillPath: '',
  createdAt: new Date().toISOString(),
};

const askUserTool = new AskUserTool();

function createAskToolContext(
  hooks: InitRuntimeHooks | undefined,
  overrides?: Partial<Pick<ToolContext, 'questionInput'>>
): ToolContext {
  const fallbackQuestionInput = hooks?.questionInput
    ? async (request: { message: string }) => hooks.questionInput!({ message: request.message })
    : undefined;

  return {
    agent: INIT_ASK_AGENT,
    agentId: INIT_ASK_AGENT.id,
    workspaceRoot: '',
    questionInput: overrides?.questionInput ?? fallbackQuestionInput,
    questionConfirm: hooks?.questionConfirm,
    questionSelect: hooks?.questionSelect,
    questionPassword: hooks?.questionPassword,
    questionChecklist: hooks?.questionChecklist,
  };
}

async function askViaTool(
  hooks: InitRuntimeHooks | undefined,
  params: {
    kind: AskKind;
    message: string;
    workflow?: {
      workflowId?: string;
      stepId?: string;
      continuationToken?: string;
      questionId?: string;
    };
    defaultText?: string;
    defaultBoolean?: boolean;
    choices?: Array<{ name: string; value: string; description?: string; recommended?: boolean }>;
    defaultChecklist?: string[];
    allowOther?: boolean;
    otherLabel?: string;
    otherPrompt?: string;
    minSelections?: number;
    maxSelections?: number;
    mask?: string;
  },
  overrides?: Partial<Pick<ToolContext, 'questionInput'>>
): Promise<unknown> {
  const result = await askUserTool.execute(params, createAskToolContext(hooks, overrides));
  if (!result || typeof result !== 'object' || !('answer' in result)) {
    throw new Error('com_ask returned an unexpected response shape.');
  }
  return (result as { answer: unknown }).answer;
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

  const answer = await askViaTool(
    hooks,
    {
      kind: 'input',
      message: request.message,
      workflow: request.workflow,
    },
    {
      questionInput: async (inputRequest) =>
        hooks.questionInput?.({
          ...request,
          message: inputRequest.message,
        }) ?? '',
    }
  );

  if (typeof answer !== 'string') {
    throw new Error('Input question expected a string answer from com_ask.');
  }

  if (request.validate) {
    const validationResult = request.validate(answer);
    if (validationResult !== true) {
      throw new Error(typeof validationResult === 'string' ? validationResult : 'Invalid input.');
    }
  }

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

  const answer = await askViaTool(hooks, {
    kind: 'confirm',
    message: request.message,
    workflow: request.workflow,
    defaultBoolean: request.default,
  });

  if (typeof answer !== 'boolean') {
    throw new Error('Confirm question expected a boolean answer from com_ask.');
  }

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

  const answer = await askViaTool(hooks, {
    kind: 'select',
    message: request.message,
    choices: request.choices,
    workflow: request.workflow,
    defaultText: request.default,
    allowOther: request.allowOther,
    otherLabel: request.otherLabel,
    otherPrompt: request.otherPrompt,
  });

  if (typeof answer !== 'string') {
    throw new Error('Select question expected a string answer from com_ask.');
  }

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

  const answer = await askViaTool(hooks, {
    kind: 'password',
    message: request.message,
    workflow: request.workflow,
    mask: request.mask,
  });

  if (typeof answer !== 'string') {
    throw new Error('Password question expected a string answer from com_ask.');
  }

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

  const answer = await askViaTool(hooks, {
    kind: 'checklist',
    message: request.message,
    choices: request.choices,
    workflow: request.workflow,
    defaultChecklist: request.default,
    minSelections: request.minSelections,
    maxSelections: request.maxSelections,
    allowOther: request.allowOther,
    otherLabel: request.otherLabel,
    otherPrompt: request.otherPrompt,
  });

  if (!Array.isArray(answer) || !answer.every((value) => typeof value === 'string')) {
    throw new Error('Checklist question expected a string[] answer from com_ask.');
  }

  const parsed = hooks?.questionChecklist ? answer : answer.map((value) => value.trim());
  if (!hooks?.questionChecklist) {
    for (const value of parsed) {
      if (!request.choices.some((choice) => choice.value === value)) {
        throw new Error(`Invalid checklist option: "${value}".`);
      }
    }
  }

  emitWorkflowResultFrame(hooks, request, parsed);
  return parsed;
}
