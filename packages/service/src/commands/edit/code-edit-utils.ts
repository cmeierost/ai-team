import type { ExecutionContext } from '@ai-team/core';
import type { InteractionContext } from '@ai-team/api-contracts';

export function toInteractionContext(runtime: ExecutionContext): InteractionContext {
  return {
    signal: runtime.signal,
    emit: runtime.emit as InteractionContext['emit'],
    questionInput: runtime.questionInput,
    questionConfirm: runtime.questionConfirm,
    questionSelect: runtime.questionSelect,
    questionPassword: runtime.questionPassword,
    questionChecklist: runtime.questionChecklist,
    workflowState: runtime.workflowState as InteractionContext['workflowState'],
    onWorkflowFrame: runtime.onWorkflowFrame,
  };
}
