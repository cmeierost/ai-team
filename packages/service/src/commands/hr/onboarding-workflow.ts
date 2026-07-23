import { z } from 'zod';
import type { ChatMessage, ExecutionContext, ICommand, ICommandDescriptor } from '@ai-team/core';
import type { WorkflowDefinition, IWorkflowRunnerFactory } from '../../workflow/index.js';
import { runWorkflowPhaseAsync } from './workflow-phase.js';

const onboardingWorkflowParamsSchema = z.object({
  workspaceRoot: z.string().optional(),
});

export type OnboardingWorkflowParams = z.infer<typeof onboardingWorkflowParamsSchema>;

export interface OnboardingWorkflowResult {
  ceoAgentId?: string;
  ceoName?: string;
  hrAgentId?: string;
  hrName?: string;
  businessTranscriptPath?: string;
  hireMessages: ChatMessage[];
}

export interface OnboardingWorkflowState extends OnboardingWorkflowParams {
  prepare_context?: {
    developerName?: string;
    businessSystemPrompt: string;
    planningSystemPrompt: string;
    ceoIntroduction: string;
    hrIntroduction: string;
    ceoPersonalityProfile: string[];
    hrPersonalityProfile: string[];
  };
  // Step results — populated by the runner via `state[step.id]` default storage
  // or via explicit `applyResult` callbacks.
  bootstrap?: { workspaceRoot: string };
  ceo_names?: { suggestions: string[] };
  pick_ceo?: { type: string; kind: string; answer: string };
  hire_ceo?: { agentId: string; name: string; role: string };
  ceo_permissions?: { agentId: string };
  business_chat?: { messages: ChatMessage[] };
  business_transcript?: { filePath: string };
  hr_names?: { suggestions: string[] };
  pick_hr?: { type: string; kind: string; answer: string };
  hire_hr?: { agentId: string; name: string; role: string };
  hr_permissions?: { agentId: string };
  hire_choice?: { type: string; kind: string; answer: string };
  hire_summary?: { content: string };
  hire_session?: { messages: ChatMessage[] };
}

const CEO_WRITE_PATTERNS = [
  '.ai-team/**/*',
  '.github/copilot-instructions.md',
  'AGENTS.md',
  'docs/**/*',
];
const HR_WRITE_PATTERNS = [
  '.ai-team/**/*',
  '.ai-team/skills-catalog/**/*',
  '.github/skills/**/*',
  '.github/copilot-instructions.md',
  'AGENTS.md',
  'docs/**/*',
];
const BROAD_READ = ['**/*'];

interface CommandDispatcherLike {
  dispatch(
    key: string,
    params: unknown,
    ctx: ExecutionContext
  ): Promise<{
    status: 'ok' | 'error' | 'cancelled';
    message?: string;
    data?: unknown;
  }>;
}

function assertOk<T>(
  response: { status: 'ok' | 'error' | 'cancelled'; message?: string; data?: unknown },
  key: string
): T {
  if (response.status !== 'ok') {
    throw new Error(response.message || `Command '${key}' failed`);
  }

  return (response.data ?? {}) as T;
}

async function dispatchTool<T>(
  dispatcher: CommandDispatcherLike,
  key: string,
  payload: unknown,
  ctx: ExecutionContext
): Promise<T> {
  return assertOk<T>(await dispatcher.dispatch(key, payload, ctx), key);
}

export const OnboardingWorkflowMetadata = {
  key: 'onboard_workflow',
  description: 'End-to-end founding-team onboarding: bootstrap, CEO, business chat, HR, hiring.',
  availableIn: { tool: true },
  group: 'hr',
  parameters: onboardingWorkflowParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'hr', 'workflow'],
} satisfies ICommandDescriptor;

/**
 * Build the onboarding workflow definition.
 *
 * The workflow resolves all runtime dependencies via tool steps:
 * - `init_bootstrap_files` seeds workspace templates/docs
 * - `init_prepare_onboarding` loads templates and derives prompt/introduction artifacts
 *
 * This workflow can be used standalone or composed with other workflows.
 */
export function createOnboardingWorkflowDefinition(
  dispatcher: CommandDispatcherLike
): WorkflowDefinition<OnboardingWorkflowState> {
  return {
    id: OnboardingWorkflowMetadata.key,
    description: OnboardingWorkflowMetadata.description,
    availableIn: OnboardingWorkflowMetadata.availableIn,
    prepare: (params: unknown) => {
      const validated = onboardingWorkflowParamsSchema.parse(params);
      if (!validated.workspaceRoot) {
        throw new Error('onboard_workflow requires workspaceRoot.');
      }
      return validated as OnboardingWorkflowState;
    },
    toResult: (state: OnboardingWorkflowState): OnboardingWorkflowResult => ({
      ceoAgentId: state.hire_ceo?.agentId,
      ceoName: state.hire_ceo?.name,
      hrAgentId: state.hire_hr?.agentId,
      hrName: state.hire_hr?.name,
      businessTranscriptPath: state.business_transcript?.filePath,
      hireMessages: state.hire_session?.messages ?? [],
    }),
    steps: [
      {
        id: 'bootstrap',
        execute: async (state, ctx) => {
          const bootstrap = await dispatchTool<{ workspaceRoot: string }>(
            dispatcher,
            'init_bootstrap_files',
            { workspaceRoot: state.workspaceRoot },
            ctx
          );
          return { ...state, bootstrap };
        },
      },
      {
        id: 'prepare_context',
        execute: async (state, ctx) => {
          const prepare_context = await dispatchTool<OnboardingWorkflowState['prepare_context']>(
            dispatcher,
            'init_prepare_onboarding',
            { workspaceRoot: state.workspaceRoot },
            ctx
          );
          return { ...state, prepare_context: prepare_context! };
        },
      },
      {
        id: 'ceo_names',
        execute: async (state, ctx) => {
          const ceo_names = await dispatchTool<{ suggestions: string[] }>(
            dispatcher,
            'hr_name_suggestions',
            { roleLabel: 'CEO', excludeNames: [], count: 5 },
            ctx
          );
          if (!ceo_names.suggestions.length) {
            throw new Error('No CEO name suggestions were generated.');
          }
          return { ...state, ceo_names };
        },
      },
      {
        id: 'pick_ceo',
        execute: async (state, ctx) => {
          const choices = (state.ceo_names?.suggestions ?? []).map((candidate) => ({
            name: candidate,
            value: candidate,
          }));
          const pick_ceo = await dispatchTool<{ type: string; kind: string; answer: string }>(
            dispatcher,
            'com_ask',
            {
              kind: 'select',
              message: 'Which candidate should we hire as CEO?',
              choices,
            },
            ctx
          );
          return { ...state, pick_ceo };
        },
      },
      {
        id: 'hire_ceo',
        execute: async (state, ctx) => {
          const hire_ceo = await dispatchTool<{ agentId: string; name: string; role: string }>(
            dispatcher,
            'hr_hire',
            {
              name: state.pick_ceo!.answer,
              role: 'ceo',
              type: 'executive',
              contextLevel: 'organization',
              personality: {
                communication_style: 'strategic',
                expertise_level: 'executive',
                mentoring: true,
              },
              introduction: state.prepare_context!.ceoIntroduction,
              personalityProfile: state.prepare_context!.ceoPersonalityProfile,
            },
            ctx
          );
          return { ...state, hire_ceo };
        },
      },
      {
        id: 'ceo_permissions',
        execute: async (state, ctx) => {
          const ceo_permissions = await dispatchTool<{ agentId: string }>(
            dispatcher,
            'access_set_permissions',
            {
              agentId: state.hire_ceo!.agentId,
              list: BROAD_READ,
              read: BROAD_READ,
              write: CEO_WRITE_PATTERNS,
            },
            ctx
          );
          return { ...state, ceo_permissions };
        },
      },
      {
        id: 'business_chat',
        execute: async (state, ctx, services) => {
          const messages = await runWorkflowPhaseAsync(
            {
              agentId: state.hire_ceo!.agentId,
              systemPrompt: state.prepare_context!.businessSystemPrompt,
              exitWords: ['done', 'clear', 'finished'],
              toolAllowlist: ['com_ask'],
            },
            ctx,
            services
          );

          return {
            ...state,
            business_chat: { messages },
          };
        },
      },
      {
        id: 'business_transcript',
        execute: async (state, ctx) => {
          const business_transcript = await dispatchTool<{ filePath: string }>(
            dispatcher,
            'docs_save_transcript',
            {
              relativePath: '.ai-team/business-definition.md',
              title: 'Business Definition',
              intro: [
                'This file captures the business-definition phase between the developer and CEO.',
                'It is generated by onboarding workflow step `business_transcript`.',
              ],
              messages: state.business_chat?.messages ?? [],
              agentLabel: `${state.pick_ceo?.answer ?? 'CEO'} (ceo)`,
              developerLabel: state.prepare_context?.developerName ?? 'Developer',
            },
            ctx
          );
          return { ...state, business_transcript };
        },
      },
      {
        id: 'hire_choice',
        execute: async (state, ctx) => {
          const hire_choice = await dispatchTool<{ type: string; kind: string; answer: string }>(
            dispatcher,
            'com_ask',
            {
              kind: 'select',
              message: 'What would you like to do next?',
              choices: [
                { name: 'Hire people now', value: 'hire' },
                { name: 'Skip hiring for now', value: 'skip' },
              ],
            },
            ctx
          );
          return { ...state, hire_choice };
        },
      },
      {
        id: 'hr_names',
        skipWhen: 'hire_choice.answer !== "hire"',
        execute: async (state, ctx) => {
          const hr_names = await dispatchTool<{ suggestions: string[] }>(
            dispatcher,
            'hr_name_suggestions',
            {
              roleLabel: 'Head of Human Resources',
              excludeNames: [state.pick_ceo?.answer].filter((name): name is string =>
                Boolean(name && name.length)
              ),
              count: 5,
            },
            ctx
          );
          if (!hr_names.suggestions.length) {
            throw new Error('No HR name suggestions were generated.');
          }
          return { ...state, hr_names };
        },
      },
      {
        id: 'pick_hr',
        skipWhen: 'hire_choice.answer !== "hire"',
        execute: async (state, ctx) => {
          const choices = (state.hr_names?.suggestions ?? []).map((candidate) => ({
            name: candidate,
            value: candidate,
          }));
          const pick_hr = await dispatchTool<{ type: string; kind: string; answer: string }>(
            dispatcher,
            'com_ask',
            {
              kind: 'select',
              message: 'Which candidate should we hire as HR Director?',
              choices,
            },
            ctx
          );
          return { ...state, pick_hr };
        },
      },
      {
        id: 'hire_hr',
        skipWhen: 'hire_choice.answer !== "hire"',
        execute: async (state, ctx) => {
          const hire_hr = await dispatchTool<{ agentId: string; name: string; role: string }>(
            dispatcher,
            'hr_hire',
            {
              name: state.pick_hr!.answer,
              role: 'hr-director',
              type: 'executive',
              contextLevel: 'organization',
              reportsTo: state.hire_ceo!.agentId,
              personality: {
                communication_style: 'supportive',
                expertise_level: 'executive',
                mentoring: true,
              },
              introduction: state.prepare_context!.hrIntroduction,
              personalityProfile: state.prepare_context!.hrPersonalityProfile,
            },
            ctx
          );
          return { ...state, hire_hr };
        },
      },
      {
        id: 'hr_permissions',
        skipWhen: 'hire_choice.answer !== "hire"',
        execute: async (state, ctx) => {
          const hr_permissions = await dispatchTool<{ agentId: string }>(
            dispatcher,
            'access_set_permissions',
            {
              agentId: state.hire_hr!.agentId,
              list: BROAD_READ,
              read: BROAD_READ,
              write: HR_WRITE_PATTERNS,
            },
            ctx
          );
          return { ...state, hr_permissions };
        },
      },
      {
        id: 'hire_summary',
        skipWhen: 'hire_choice.answer !== "hire"',
        execute: async (state, ctx) => {
          const hire_summary = await dispatchTool<{ content: string }>(
            dispatcher,
            'llm_call',
            {
              systemPrompt:
                'You summarize a business definition conversation into one concise paragraph (3-5 sentences). Focus on: business purpose, target users, technical direction. Return only the summary text.',
              userPrompt: `Summarize this conversation transcript: ${JSON.stringify(state.business_chat?.messages ?? [])}`,
              maxTokens: 300,
              temperature: 0.5,
            },
            ctx
          );
          return { ...state, hire_summary };
        },
      },
      {
        id: 'hire_session',
        skipWhen: 'hire_choice.answer !== "hire"',
        execute: async (state, ctx) => {
          const hire_session = await dispatchTool<{ messages: ChatMessage[] }>(
            dispatcher,
            'hr_hire_workflow',
            {
              hrAgentId: state.hire_hr!.agentId,
              requesterAgentId: state.hire_ceo!.agentId,
              instructions:
                `## Business context\n\n${state.hire_summary?.content ?? ''}\n\n` +
                `## Hire mandate\n\n${state.prepare_context?.planningSystemPrompt ?? ''}`,
              openingMessage:
                `Welcome ${state.pick_hr?.answer ?? 'HR Director'}. ` +
                'Read the hire request and start hiring the team. ' +
                'Use `hr_hire` for each new member, `access_set_permissions` to grant access, and say `done` when finished.',
            },
            ctx
          );

          return { ...state, hire_session };
        },
      },
    ],
  };
}

/**
 * Factory function to create the onboarding workflow as a command.
 * Requires dispatcher for tool execution.
 * Use with WorkflowRunnerFactory.asCommand() for composable workflows.
 */
export function createOnboardingWorkflowCommand(
  dispatcher: CommandDispatcherLike
): WorkflowDefinition<OnboardingWorkflowState> {
  return createOnboardingWorkflowDefinition(dispatcher);
}

/**
 * Legacy command wrapper - prefer using WorkflowRunnerFactory.asCommand() directly.
 * @deprecated Use createOnboardingWorkflowCommand() with WorkflowRunnerFactory.asCommand()
 */
export class OnboardingWorkflowCommand implements ICommand<
  OnboardingWorkflowParams,
  OnboardingWorkflowResult
> {
  readonly metadata = OnboardingWorkflowMetadata;

  constructor(
    private readonly dispatcher: CommandDispatcherLike,
    private readonly workflowRunnerFactory: IWorkflowRunnerFactory
  ) {}

  async execute(
    params: OnboardingWorkflowParams,
    ctx: ExecutionContext
  ): Promise<{ status: 'ok' | 'error'; message?: string; data?: OnboardingWorkflowResult }> {
    const workspaceRoot = params.workspaceRoot;
    if (!workspaceRoot) {
      return {
        status: 'error',
        message: 'onboard_workflow requires workspaceRoot.',
      };
    }

    const initialState: OnboardingWorkflowState = {
      workspaceRoot,
    };

    const result = await this.workflowRunnerFactory
      .create()
      .run(createOnboardingWorkflowDefinition(this.dispatcher), initialState, {
        signal: ctx.signal,
        executionContext: ctx,
      });

    const data: OnboardingWorkflowResult = {
      ceoAgentId: result.state.hire_ceo?.agentId,
      ceoName: result.state.hire_ceo?.name,
      hrAgentId: result.state.hire_hr?.agentId,
      hrName: result.state.hire_hr?.name,
      businessTranscriptPath: result.state.business_transcript?.filePath,
      hireMessages: result.state.hire_session?.messages ?? [],
    };

    return {
      status: 'ok',
      data,
    };
  }
}
