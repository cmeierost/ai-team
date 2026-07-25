import { z } from 'zod';
import type { ExecutionContext, ICommand, ICommandDescriptor } from '@ai-team/core';
import type { WorkflowDefinition, IWorkflowRunnerFactory } from '../../workflow/index.js';

const onboardingWorkflowParamsSchema = z.object({
  workspaceRoot: z.string().optional(),
});

export type OnboardingWorkflowParams = z.infer<typeof onboardingWorkflowParamsSchema>;

export interface OnboardingWorkflowResult {
  ceoAgentId?: string;
  ceoName?: string;
  businessSystemPrompt?: string;
  businessOpeningMessage?: string;
}

export interface OnboardingWorkflowState extends OnboardingWorkflowParams {
  prepare_context?: {
    developerName?: string;
    businessSystemPrompt: string;
    businessIntroLines: string[];
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
}

const CEO_WRITE_PATTERNS = [
  '.ai-team/**/*',
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

function buildBusinessOpeningMessage(state: OnboardingWorkflowState): string | undefined {
  const lines = state.prepare_context?.businessIntroLines ?? [];
  if (lines.length === 0) return undefined;

  const ceoName = state.hire_ceo?.name ?? state.pick_ceo?.answer ?? 'CEO';
  return lines
    .map((line) => line.replaceAll('{{ceoName}}', ceoName))
    .join('\n\n')
    .trim();
}

export const OnboardingWorkflowMetadata = {
  key: 'onboard_workflow',
  description: 'Bootstrap the workspace and create the founding CEO before chat takes over.',
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
 * This setup workflow deliberately ends after CEO creation. Interactive chat is
 * a presentation concern and is started by the invoking adapter from the
 * returned CEO identity.
 */
export function createOnboardingWorkflowDefinition(
  dispatcher: CommandDispatcherLike
): WorkflowDefinition<OnboardingWorkflowState> {
  return {
    id: OnboardingWorkflowMetadata.key,
    version: '1',
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
      businessSystemPrompt: state.prepare_context?.businessSystemPrompt,
      businessOpeningMessage: buildBusinessOpeningMessage(state),
    }),
    steps: [
      {
        id: 'bootstrap',
        execute: async (state, ctx) => {
          const bootstrap = await dispatchTool<{ workspaceRoot: string }>(
            dispatcher,
            'init-bootstrap_files',
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
            'init-prepare_onboarding',
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
            'hr-name_suggestions',
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
            'com-ask',
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
          const ceoName = state.pick_ceo!.answer;
          const hire_ceo = await dispatchTool<{ agentId: string; name: string; role: string }>(
            dispatcher,
            'hr-hire_agent',
            {
              name: ceoName,
              role: 'ceo',
              type: 'executive',
              contextLevel: 'organization',
              personality: {
                communication_style: 'strategic',
                expertise_level: 'executive',
                mentoring: true,
              },
              introduction: state.prepare_context!.ceoIntroduction.replaceAll(
                '{{pick_ceo.answer}}',
                ceoName
              ),
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
            'access-set_permissions',
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

    if (result.aborted) {
      return {
        status: 'error',
        message: result.abortedError ?? 'Onboarding workflow aborted.',
      };
    }

    const data: OnboardingWorkflowResult = {
      ceoAgentId: result.state.hire_ceo?.agentId,
      ceoName: result.state.hire_ceo?.name,
      businessSystemPrompt: result.state.prepare_context?.businessSystemPrompt,
      businessOpeningMessage: buildBusinessOpeningMessage(result.state),
    };

    return {
      status: 'ok',
      data,
    };
  }
}
