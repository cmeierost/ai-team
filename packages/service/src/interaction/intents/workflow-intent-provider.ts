import type { ExecutionContext } from '@ai-team/core';
import type { PreLlmIntentProvider, ScoredPreLlmIntentCandidate } from './pre-llm-intents.js';

const WORKFLOW_SWITCH_PATTERNS: readonly RegExp[] = [
  /\b(switch|change|move|jump)\b.*\bworkflow\b/i,
  /\b(different|another|new)\b.*\bworkflow\b/i,
  /\bworkflow\s+(mode|type)\b/i,
];

const MULTI_SELECT_HINT_PATTERNS: readonly RegExp[] = [
  /\b(multiple|multi|several|all)\b/i,
  /\b(compare|parallel|together)\b/i,
  /\b(and|or)\b/i,
];

const DEFAULT_WORKFLOW_CHOICES: Array<{ name: string; value: string; description: string }> = [
  {
    name: 'Implementation workflow',
    value: 'implementation',
    description: 'Code-first delivery with test and verification loops.',
  },
  {
    name: 'Debugging workflow',
    value: 'debugging',
    description: 'Reproduce, isolate root cause, patch, and regression test.',
  },
  {
    name: 'Research workflow',
    value: 'research',
    description: 'Gather and synthesize findings before implementation.',
  },
  {
    name: 'Planning workflow',
    value: 'planning',
    description: 'Clarify scope and produce an execution plan.',
  },
  {
    name: 'Onboarding workflow',
    value: 'onboarding',
    description: 'Team setup and guided onboarding flow.',
  },
];

function isWorkflowSwitchRequest(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return WORKFLOW_SWITCH_PATTERNS.some((pattern) => pattern.test(text));
}

function prefersMultiSelect(message: string): boolean {
  return MULTI_SELECT_HINT_PATTERNS.some((pattern) => pattern.test(message));
}

function buildChoices(activeWorkflowId?: string) {
  return DEFAULT_WORKFLOW_CHOICES.map((choice) => ({
    ...choice,
    recommended: choice.value === activeWorkflowId,
  }));
}

export class WorkflowIntentProvider implements PreLlmIntentProvider {
  async resolveCandidates(
    message: string,
    ctx: ExecutionContext
  ): Promise<ScoredPreLlmIntentCandidate[]> {
    const text = message.trim();
    if (!isWorkflowSwitchRequest(text)) {
      return [];
    }

    const activeWorkflowId = ctx.workflowId;
    const choices = buildChoices(activeWorkflowId);
    const useChecklist = prefersMultiSelect(text);

    return [
      {
        kind: 'tool',
        toolName: 'com_ask',
        args: {
          kind: useChecklist ? 'checklist' : 'select',
          message: useChecklist
            ? 'Select all workflow types you want to switch to before I continue.'
            : 'Which workflow type should I switch to before I continue?',
          workflow: {
            workflowId: activeWorkflowId,
            questionId: 'pre-llm-workflow-switch',
          },
          choices,
          ...(useChecklist
            ? {
                defaultChecklist: activeWorkflowId ? [activeWorkflowId] : undefined,
                minSelections: 1,
                maxSelections: 3,
              }
            : {
                defaultText: activeWorkflowId,
              }),
        },
        score: 93,
        reason: activeWorkflowId
          ? `Workflow switch request while active workflow is '${activeWorkflowId}'.`
          : 'Workflow switch request detected.',
        source: 'workflow-intent-provider',
      },
    ];
  }
}
