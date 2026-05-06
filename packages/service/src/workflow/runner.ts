import { randomUUID } from 'node:crypto';
import type { InteractionContext } from '@ai-team/api-contracts';
import type { WorkflowDefinition, WorkflowResult, WorkflowStep } from './types.js';
import {
  ensureNotAborted,
  emitWorkflowQuestionFrame,
  emitWorkflowResultFrame,
  resolveWorkflowAnswer,
} from './helpers.js';

function resolveMessage<TState>(
  message: string | ((state: TState) => string),
  state: TState
): string {
  return typeof message === 'function' ? message(state) : message;
}

async function executeConfirmStep<TState>(
  step: Extract<WorkflowStep<TState>, { kind: 'confirm' }>,
  state: TState,
  context: InteractionContext,
  workflowId: string
): Promise<{ state: TState; aborted: boolean }> {
  const message = resolveMessage(step.message, state);
  const workflow = { workflowId, stepId: step.id, questionId: step.id };
  const request = { message, default: step.default, workflow };

  emitWorkflowQuestionFrame(context, { kind: 'confirm', ...request });
  context.emit?.({ kind: 'question', questionType: 'confirm', message });

  const resumed = resolveWorkflowAnswer(context, { workflow });
  if (typeof resumed === 'boolean') {
    emitWorkflowResultFrame(context, { workflow }, resumed);
    if (!resumed && step.onDeclined === 'abort') return { state, aborted: true };
    return { state, aborted: false };
  }

  if (!context.questionConfirm) {
    throw new Error(
      `Workflow "${workflowId}" step "${step.id}": confirm question requested but no questionConfirm handler available.`
    );
  }

  const answer = await context.questionConfirm(request);
  emitWorkflowResultFrame(context, { workflow }, answer);
  if (!answer && step.onDeclined === 'abort') return { state, aborted: true };
  return { state, aborted: false };
}

async function executeInputStep<TState>(
  step: Extract<WorkflowStep<TState>, { kind: 'input' }>,
  state: TState,
  context: InteractionContext,
  workflowId: string
): Promise<TState> {
  const message = resolveMessage(step.message, state);
  const workflow = { workflowId, stepId: step.id, questionId: step.id };
  const request = { message, validate: step.validate, workflow };

  emitWorkflowQuestionFrame(context, { kind: 'input', ...request });
  context.emit?.({ kind: 'question', questionType: 'input', message });

  const resumed = resolveWorkflowAnswer(context, { workflow });
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(context, { workflow }, resumed);
    return step.applyAnswer(state, resumed);
  }

  if (!context.questionInput) {
    throw new Error(
      `Workflow "${workflowId}" step "${step.id}": input question requested but no questionInput handler available.`
    );
  }

  const answer = await context.questionInput(request);
  emitWorkflowResultFrame(context, { workflow }, answer);
  return step.applyAnswer(state, answer);
}

async function executeSelectStep<TState>(
  step: Extract<WorkflowStep<TState>, { kind: 'select' }>,
  state: TState,
  context: InteractionContext,
  workflowId: string
): Promise<TState> {
  const message = resolveMessage(step.message, state);
  const choices = step.choices(state);
  const workflow = { workflowId, stepId: step.id, questionId: step.id };
  const request = { message, choices, workflow };

  emitWorkflowQuestionFrame(context, { kind: 'select', ...request });
  context.emit?.({ kind: 'question', questionType: 'select', message, choices });

  const resumed = resolveWorkflowAnswer(context, { workflow });
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(context, { workflow }, resumed);
    return step.applyAnswer(state, resumed);
  }

  if (!context.questionSelect) {
    throw new Error(
      `Workflow "${workflowId}" step "${step.id}": select question requested but no questionSelect handler available.`
    );
  }

  const answer = await context.questionSelect(request);
  emitWorkflowResultFrame(context, { workflow }, answer);
  return step.applyAnswer(state, answer);
}

async function executePasswordStep<TState>(
  step: Extract<WorkflowStep<TState>, { kind: 'password' }>,
  state: TState,
  context: InteractionContext,
  workflowId: string
): Promise<TState> {
  const message = resolveMessage(step.message, state);
  const workflow = { workflowId, stepId: step.id, questionId: step.id };
  const request = { message, workflow };

  emitWorkflowQuestionFrame(context, { kind: 'password', ...request });
  context.emit?.({ kind: 'question', questionType: 'password', message });

  const resumed = resolveWorkflowAnswer(context, { workflow });
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(context, { workflow }, resumed);
    return step.applyAnswer(state, resumed);
  }

  if (!context.questionPassword) {
    throw new Error(
      `Workflow "${workflowId}" step "${step.id}": password question requested but no questionPassword handler available.`
    );
  }

  const answer = await context.questionPassword(request);
  emitWorkflowResultFrame(context, { workflow }, answer);
  return step.applyAnswer(state, answer);
}

async function executeChecklistStep<TState>(
  step: Extract<WorkflowStep<TState>, { kind: 'checklist' }>,
  state: TState,
  context: InteractionContext,
  workflowId: string
): Promise<TState> {
  const message = resolveMessage(step.message, state);
  const choices = step.choices(state);
  const workflow = { workflowId, stepId: step.id, questionId: step.id };
  const request = {
    message,
    choices,
    minSelections: step.minSelections,
    maxSelections: step.maxSelections,
    workflow,
  };

  emitWorkflowQuestionFrame(context, { kind: 'checklist', ...request });
  context.emit?.({ kind: 'question', questionType: 'checklist', message, choices });

  const resumed = resolveWorkflowAnswer(context, { workflow });
  if (Array.isArray(resumed) && resumed.every((v) => typeof v === 'string')) {
    emitWorkflowResultFrame(context, { workflow }, resumed);
    return step.applyAnswer(state, resumed);
  }

  if (!context.questionChecklist) {
    throw new Error(
      `Workflow "${workflowId}" step "${step.id}": checklist question requested but no questionChecklist handler available.`
    );
  }

  const answer = await context.questionChecklist(request);
  emitWorkflowResultFrame(context, { workflow }, answer);
  return step.applyAnswer(state, answer);
}

export async function runWorkflowAsync<TState>(
  definition: WorkflowDefinition<TState>,
  initialState: TState,
  context: InteractionContext
): Promise<WorkflowResult<TState>> {
  let state = initialState;
  const instanceId = `${definition.id}:${randomUUID()}`;

  for (const step of definition.steps) {
    ensureNotAborted(context);

    if (step.skipWhen?.(state)) {
      continue;
    }

    context.onWorkflowFrame?.({
      workflowId: instanceId,
      stepId: step.id,
    });

    switch (step.kind) {
      case 'action': {
        state = await step.execute(state, context);
        context.onWorkflowFrame?.({
          workflowId: instanceId,
          stepId: step.id,
          completed: true,
        });
        break;
      }

      case 'confirm': {
        const result = await executeConfirmStep(step, state, context, instanceId);
        state = result.state;
        if (result.aborted) {
          return { state, aborted: true };
        }
        break;
      }

      case 'input': {
        state = await executeInputStep(step, state, context, instanceId);
        break;
      }

      case 'select': {
        state = await executeSelectStep(step, state, context, instanceId);
        break;
      }

      case 'password': {
        state = await executePasswordStep(step, state, context, instanceId);
        break;
      }

      case 'checklist': {
        state = await executeChecklistStep(step, state, context, instanceId);
        break;
      }
    }
  }

  return { state, aborted: false };
}
