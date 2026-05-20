import { randomUUID } from 'node:crypto';
import type { WorkflowStateSnapshot } from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';
import type { WorkflowDefinition, WorkflowResult, WorkflowStep } from './types.js';
import {
  ensureNotAborted,
  emitWorkflowQuestionFrame,
  emitWorkflowResultFrame,
  resolveWorkflowAnswer,
  type WorkflowRuntimeContext,
} from './helpers.js';
import { type IQuestionService } from '../questions/question-service.js';

function resolveMessage<TState>(
  message: string | ((state: TState) => string),
  state: TState
): string {
  return typeof message === 'function' ? message(state) : message;
}

async function executeConfirmStep<TState>(
  step: Extract<WorkflowStep<TState>, { kind: 'confirm' }>,
  state: TState,
  context: ExecutionContext,
  workflowContext: WorkflowRuntimeContext,
  questionService: IQuestionService,
  workflowId: string
): Promise<{ state: TState; aborted: boolean }> {
  const message = resolveMessage(step.message, state);
  const workflow = { workflowId, stepId: step.id, questionId: step.id };
  const request = { message, default: step.default, workflow };

  emitWorkflowQuestionFrame(workflowContext, { kind: 'confirm', ...request });
  workflowContext.emit?.({ kind: 'question', questionType: 'confirm', message });

  const resumed = resolveWorkflowAnswer(workflowContext, { workflow });
  if (typeof resumed === 'boolean') {
    emitWorkflowResultFrame(workflowContext, { workflow }, resumed);
    if (!resumed && step.onDeclined === 'abort') return { state, aborted: true };
    return { state, aborted: false };
  }

  const answer = await questionService.confirm(request, context);
  emitWorkflowResultFrame(workflowContext, { workflow }, answer);
  if (!answer && step.onDeclined === 'abort') return { state, aborted: true };
  return { state, aborted: false };
}

async function executeInputStep<TState>(
  step: Extract<WorkflowStep<TState>, { kind: 'input' }>,
  state: TState,
  context: ExecutionContext,
  workflowContext: WorkflowRuntimeContext,
  questionService: IQuestionService,
  workflowId: string
): Promise<TState> {
  const message = resolveMessage(step.message, state);
  const workflow = { workflowId, stepId: step.id, questionId: step.id };
  const request = { message, validate: step.validate, workflow };

  emitWorkflowQuestionFrame(workflowContext, { kind: 'input', ...request });
  workflowContext.emit?.({ kind: 'question', questionType: 'input', message });

  const resumed = resolveWorkflowAnswer(workflowContext, { workflow });
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(workflowContext, { workflow }, resumed);
    return step.applyAnswer(state, resumed);
  }

  const answer = await questionService.input(request, context);
  emitWorkflowResultFrame(workflowContext, { workflow }, answer);
  return step.applyAnswer(state, answer);
}

async function executeSelectStep<TState>(
  step: Extract<WorkflowStep<TState>, { kind: 'select' }>,
  state: TState,
  context: ExecutionContext,
  workflowContext: WorkflowRuntimeContext,
  questionService: IQuestionService,
  workflowId: string
): Promise<TState> {
  const message = resolveMessage(step.message, state);
  const choices = step.choices(state);
  const workflow = { workflowId, stepId: step.id, questionId: step.id };
  const request = { message, choices, workflow };

  emitWorkflowQuestionFrame(workflowContext, { kind: 'select', ...request });
  workflowContext.emit?.({ kind: 'question', questionType: 'select', message, choices });

  const resumed = resolveWorkflowAnswer(workflowContext, { workflow });
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(workflowContext, { workflow }, resumed);
    return step.applyAnswer(state, resumed);
  }

  const answer = await questionService.select(request, context);
  emitWorkflowResultFrame(workflowContext, { workflow }, answer);
  return step.applyAnswer(state, answer);
}

async function executePasswordStep<TState>(
  step: Extract<WorkflowStep<TState>, { kind: 'password' }>,
  state: TState,
  context: ExecutionContext,
  workflowContext: WorkflowRuntimeContext,
  questionService: IQuestionService,
  workflowId: string
): Promise<TState> {
  const message = resolveMessage(step.message, state);
  const workflow = { workflowId, stepId: step.id, questionId: step.id };
  const request = { message, workflow };

  emitWorkflowQuestionFrame(workflowContext, { kind: 'password', ...request });
  workflowContext.emit?.({ kind: 'question', questionType: 'password', message });

  const resumed = resolveWorkflowAnswer(workflowContext, { workflow });
  if (typeof resumed === 'string') {
    emitWorkflowResultFrame(workflowContext, { workflow }, resumed);
    return step.applyAnswer(state, resumed);
  }

  const answer = await questionService.password(request, context);
  emitWorkflowResultFrame(workflowContext, { workflow }, answer);
  return step.applyAnswer(state, answer);
}

async function executeChecklistStep<TState>(
  step: Extract<WorkflowStep<TState>, { kind: 'checklist' }>,
  state: TState,
  context: ExecutionContext,
  workflowContext: WorkflowRuntimeContext,
  questionService: IQuestionService,
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

  emitWorkflowQuestionFrame(workflowContext, { kind: 'checklist', ...request });
  workflowContext.emit?.({ kind: 'question', questionType: 'checklist', message, choices });

  const resumed = resolveWorkflowAnswer(workflowContext, { workflow });
  if (Array.isArray(resumed) && resumed.every((v) => typeof v === 'string')) {
    emitWorkflowResultFrame(workflowContext, { workflow }, resumed);
    return step.applyAnswer(state, resumed);
  }

  const answer = await questionService.checklist(request, context);
  emitWorkflowResultFrame(workflowContext, { workflow }, answer);
  return step.applyAnswer(state, answer);
}

export async function runWorkflowAsync<TState>(
  definition: WorkflowDefinition<TState>,
  initialState: TState,
  context: ExecutionContext,
  questionService: IQuestionService
): Promise<WorkflowResult<TState>> {
  let state = initialState;
  const instanceId = `${definition.id}:${randomUUID()}`;
  const workflowContext: WorkflowRuntimeContext = {
    signal: context.signal,
    workflowState: context.workflowState as WorkflowStateSnapshot | undefined,
    onWorkflowFrame: context.onWorkflowFrame,
    emit: context.emit,
  };

  for (const step of definition.steps) {
    ensureNotAborted(workflowContext);

    if (step.skipWhen?.(state)) {
      continue;
    }

    workflowContext.onWorkflowFrame?.({
      workflowId: instanceId,
      stepId: step.id,
    });

    switch (step.kind) {
      case 'action': {
        state = await step.execute(state, workflowContext);
        workflowContext.onWorkflowFrame?.({
          workflowId: instanceId,
          stepId: step.id,
          completed: true,
        });
        break;
      }

      case 'confirm': {
        const result = await executeConfirmStep(
          step,
          state,
          context,
          workflowContext,
          questionService,
          instanceId
        );
        state = result.state;
        if (result.aborted) {
          return { state, aborted: true };
        }
        break;
      }

      case 'input': {
        state = await executeInputStep(
          step,
          state,
          context,
          workflowContext,
          questionService,
          instanceId
        );
        break;
      }

      case 'select': {
        state = await executeSelectStep(
          step,
          state,
          context,
          workflowContext,
          questionService,
          instanceId
        );
        break;
      }

      case 'password': {
        state = await executePasswordStep(
          step,
          state,
          context,
          workflowContext,
          questionService,
          instanceId
        );
        break;
      }

      case 'checklist': {
        state = await executeChecklistStep(
          step,
          state,
          context,
          workflowContext,
          questionService,
          instanceId
        );
        break;
      }
    }
  }

  return { state, aborted: false };
}
