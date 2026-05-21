/**
 * JSON Workflow Tool
 *
 * Allows defining simple step-based workflows as plain JSON files.
 * JSON workflows are loaded from `.ai-team/workflows/*.json` at startup
 * and registered into ToolManager as first-class tools.
 *
 * JSON workflow format (serializable subset of WorkflowDefinition):
 * - Steps can be: input | confirm | select | checklist | llm-summarize
 * - All messages and choices are static strings (no functions)
 * - An optional "summarize" step at the end asks the LLM to summarize collected answers
 */

import { z } from 'zod';
import type { ExecutionContext } from '@ai-team/core';
import type { IInteractionService } from '../questions/question-service.js';
import { WorkflowAbortError } from './types.js';
import type { IWorkflowRunnerFactory } from './runner.js';
import type { WorkflowDefinitionApiResponse } from '@ai-team/api-contracts';

import type { WorkflowDefinition } from './types.js';

import type { IWorkflowDefinitionProvider } from '../commands/workflow/workflow-tools.command.js';

const JsonWorkflowChoiceSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const JsonWorkflowStepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('input'),
    id: z.string(),
    message: z.string(),
    storeAs: z.string(), // key in the answers record
  }),
  z.object({
    kind: z.literal('confirm'),
    id: z.string(),
    message: z.string(),
    default: z.boolean().optional(),
    onDeclined: z.enum(['abort', 'skip']).default('skip'),
  }),
  z.object({
    kind: z.literal('select'),
    id: z.string(),
    message: z.string(),
    choices: z.array(JsonWorkflowChoiceSchema),
    storeAs: z.string(),
  }),
  z.object({
    kind: z.literal('checklist'),
    id: z.string(),
    message: z.string(),
    choices: z.array(JsonWorkflowChoiceSchema),
    storeAs: z.string(),
    minSelections: z.number().optional(),
    maxSelections: z.number().optional(),
  }),
  z.object({
    kind: z.literal('llm-summarize'),
    id: z.string(),
    prompt: z.string().optional(), // optional custom prompt prefix for the LLM
  }),
]);

export const JsonWorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  steps: z.array(JsonWorkflowStepSchema),
});

export type JsonWorkflow = z.infer<typeof JsonWorkflowSchema>;
export type JsonWorkflowStep = z.infer<typeof JsonWorkflowStepSchema>;

// ─── State record used during execution ─────────────────────────────────────

type WorkflowState = {
  answers: Record<string, string | string[] | boolean>;
  summary?: string;
};

// ─── Tool class ──────────────────────────────────────────────────────────────

export interface JsonWorkflowResult {
  type: 'json_workflow_result';
  workflowId: string;
  answers: Record<string, string | string[] | boolean>;
  summary?: string;
}

export class JsonWorkflowTool implements IWorkflowDefinitionProvider {
  readonly name: string;
  readonly key: string;
  readonly description: string;
  readonly group = 'workflow' as const;
  readonly tags = ['workflow', 'json-workflow'];
  readonly availableIn = { chat: true, cli: true, tool: true };
  readonly permissionCheck = { type: 'none' as const };
  readonly parameters = z.object({});

  constructor(
    private readonly definition: JsonWorkflow,
    private readonly runnerFactory: IWorkflowRunnerFactory,
    private readonly questionService: IInteractionService
  ) {
    this.key = definition.id;
    this.name = definition.name;
    this.description = definition.description;
  }

  getDefinition(): WorkflowDefinitionApiResponse {
    // Represent as a workflow/v1 document with the step list as states.
    // The contract requires each state to provide transitions, so keep it minimal.
    const states: Record<string, { transitions: Array<{ event: string; target?: string }> }> = {};
    for (const step of this.definition.steps) {
      states[step.id] = { transitions: [] };
    }
    return {
      workflowId: this.definition.id,
      format: 'workflow/v1',
      definitionJson: {
        format: 'workflow/v1',
        id: this.definition.id,
        initial: this.definition.steps[0]?.id ?? 'done',
        states,
      },
      definitionYaml: `format: workflow/v1\nid: ${this.definition.id}\n# ${this.definition.description}\nsteps: ${this.definition.steps.length}`,
    };
  }

  async execute(
    _params: Record<string, never>,
    context: ExecutionContext,
    _runtime: ExecutionContext
  ): Promise<JsonWorkflowResult> {
    const def = this.definition;
    const initialState: WorkflowState = { answers: {} };

    // Build a step-based WorkflowDefinition from the JSON definition
    const runtimeSteps: WorkflowDefinition<WorkflowState>['steps'] = [];

    for (const step of def.steps) {
      if (step.kind === 'input') {
        const { id, message, storeAs } = step;
        const qs = this.questionService;
        runtimeSteps.push({
          id,
          execute: async (state: WorkflowState) => {
            const answer = await qs.input({ message });
            return { ...state, answers: { ...state.answers, [storeAs]: answer } };
          },
        });
      } else if (step.kind === 'confirm') {
        const { id, message } = step;
        const onDeclined = step.onDeclined;
        const defaultVal = step.default;
        const qs = this.questionService;
        runtimeSteps.push({
          id,
          execute: async (state: WorkflowState) => {
            const ok = await qs.confirm({ message, default: defaultVal });
            if (!ok && onDeclined === 'abort') throw new WorkflowAbortError();
            return state;
          },
        });
      } else if (step.kind === 'select') {
        const { id, message, choices, storeAs } = step;
        const qs = this.questionService;
        runtimeSteps.push({
          id,
          execute: async (state: WorkflowState) => {
            const answer = await qs.select({ message, choices });
            return { ...state, answers: { ...state.answers, [storeAs]: answer } };
          },
        });
      } else if (step.kind === 'checklist') {
        const { id, message, choices, storeAs, minSelections, maxSelections } = step;
        const qs = this.questionService;
        runtimeSteps.push({
          id,
          execute: async (state: WorkflowState) => {
            const answer = await qs.checklist({
              message,
              choices,
              minSelections,
              maxSelections,
            });
            return { ...state, answers: { ...state.answers, [storeAs]: answer } };
          },
        });
      } else if (step.kind === 'llm-summarize') {
        const { id } = step;
        const promptPrefix =
          step.prompt ?? 'Summarize the following answers in a fun and concise way:';
        runtimeSteps.push({
          id,
          execute: async (state: WorkflowState) => {
            const answersText = Object.entries(state.answers)
              .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
              .join('\n');
            // Use the LLM via the context resolver if available
            try {
              const llmService = (context as any).resolve?.('LlmService') as
                | { complete(prompt: string): Promise<string> }
                | undefined;
              if (llmService?.complete) {
                const summary = await llmService.complete(`${promptPrefix}\n\n${answersText}`);
                return { ...state, summary };
              }
            } catch {
              // LLM unavailable — produce a simple concatenation
            }
            return { ...state, summary: answersText };
          },
        });
      }
    }

    const workflowDef: WorkflowDefinition<WorkflowState> = {
      id: def.id,
      description: def.description,
      availableIn: {},
      steps: runtimeSteps,
    };

    const result = await this.runnerFactory.create().run(workflowDef, initialState, {
      executionContext: context,
    });

    return {
      type: 'json_workflow_result',
      workflowId: def.id,
      answers: result.state.answers,
      summary: result.state.summary,
    };
  }
}
