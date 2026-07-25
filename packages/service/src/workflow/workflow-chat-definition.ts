import { resolveTemplateExpressions } from './workflow-param-resolver.js';
import type { WorkflowArgValue, WorkflowChatStep } from './workflow-types.js';

export interface ResolvedWorkflowChatDefinition {
  agentId?: string;
  systemPrompt: string;
  toolAllowlist: string[];
  done: { command: string; args?: Record<string, unknown> };
  finalize: { command: string; args?: Record<string, unknown> };
}

export function resolveWorkflowChatDefinition<TState>(
  step: WorkflowChatStep<TState>, state: TState
): ResolvedWorkflowChatDefinition {
  const data = state as Record<string, unknown>;
  const agentId = step.agentId === undefined ? undefined : resolveValue(step.agentId, data);
  const systemPrompt = resolveValue(step.chat.systemPrompt, data);
  if (typeof systemPrompt !== 'string') throw new Error(`Chat step '${step.id}' resolved a non-string system prompt.`);
  if (agentId !== undefined && typeof agentId !== 'string') throw new Error(`Chat step '${step.id}' resolved a non-string agent ID.`);
  return {
    ...(agentId ? { agentId } : {}),
    systemPrompt,
    toolAllowlist: [...step.chat.toolPolicy.allow],
    done: { command: step.done.command, ...(step.done.args ? { args: resolveTemplateExpressions(step.done.args, data) } : {}) },
    finalize: { command: step.finalize.command, ...(step.finalize.args ? { args: resolveTemplateExpressions(step.finalize.args, data) } : {}) },
  };
}

function resolveValue(value: WorkflowArgValue, state: Record<string, unknown>): unknown {
  return resolveTemplateExpressions({ value }, state).value;
}
