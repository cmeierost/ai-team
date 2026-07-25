import { z } from 'zod';
import type { ExecutionContext, ICommand, ICommandDescriptor } from '@ai-team/core';
import type { WorkflowDefinition, IWorkflowRunnerFactory } from '../../workflow/index.js';
import type { BusinessDefinitionFinalizedOutput } from '../orchestration/business-definition.tool.js';
import type { HiringFinalizedOutput } from '../orchestration/hiring-completion.tool.js';

const onboardingWorkflowParamsSchema = z.object({
  workspaceRoot: z.string().optional(),
});

export type OnboardingWorkflowParams = z.infer<typeof onboardingWorkflowParamsSchema>;

export interface OnboardingWorkflowResult {
  ceoAgentId?: string;
  ceoName?: string;
  hrAgentId?: string;
  hrName?: string;
  businessSystemPrompt?: string;
  businessOpeningMessage?: string;
  businessDefinition?: BusinessDefinitionFinalizedOutput;
  hiringCompletion?: HiringFinalizedOutput;
}

interface OnboardingPreparationContext {
  developerName?: string;
  businessSystemPrompt: string;
  businessIntroLines: string[];
  planningSystemPrompt: string;
  ceoIntroduction: string;
  hrIntroduction: string;
  ceoPersonalityProfile: string[];
  hrPersonalityProfile: string[];
  businessPhaseSystemPrompt: string;
  hrHiringPhaseSystemPrompt: string;
}

export interface OnboardingWorkflowState extends OnboardingWorkflowParams {
  prepare_context?: OnboardingPreparationContext;
  // Step results — populated by the runner via `state[step.id]` default storage
  // or via explicit `applyResult` callbacks.
  bootstrap?: { workspaceRoot: string };
  ceo_names?: { suggestions: string[] };
  pick_ceo?: { type: string; kind: string; answer: string };
  hire_ceo?: { agentId: string; name: string; role: string };
  ceo_permissions?: { agentId: string };
  business_definition?: BusinessDefinitionFinalizedOutput;
  hr_names?: { suggestions: string[] };
  pick_hr?: { type: string; kind: string; answer: string };
  hire_hr?: { agentId: string; name: string; role: string };
  hr_permissions?: { agentId: string };
  hr_hiring?: HiringFinalizedOutput;
}

const CEO_WRITE_PATTERNS = [
  '.ai-team/**/*',
  '.github/copilot-instructions.md',
  'AGENTS.md',
  'docs/**/*',
];
const BROAD_READ = ['**/*'];
const HR_WRITE_PATTERNS = ['.ai-team/**/*', '.github/copilot-instructions.md', 'AGENTS.md', 'docs/**/*'];
const CEO_BUSINESS_TOOL_ALLOWLIST = [
  'fs-read',
  'fs-write',
  'fs-edit',
  'fs-list',
  'fs-search',
  'init-check_business_definition',
  'init-approve_business_definition',
  'init-finalize_business_definition',
];
const HR_HIRING_TOOL_ALLOWLIST = [
  'hr-name_suggestions',
  'hr-hire_agent',
  'access-set_permissions',
  'com-ask',
  'init-check_hiring_completion',
  'init-finalize_hiring_completion',
];

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

function buildBusinessPhaseSystemPrompt(basePrompt: string): string {
  return [
    basePrompt.trim(),
    '',
    '## Workflow completion contract (strict)',
    '- Keep `.ai-team/business.md` current as decisions stabilize.',
    '- Ask one focused question at a time and avoid batching unrelated questions.',
    '- Use `init-check_business_definition` frequently to validate progress.',
    '- When the developer explicitly approves the current document revision, call `init-approve_business_definition` immediately.',
    '- After approval, run `init-check_business_definition` again and only then call `init-finalize_business_definition`.',
    '- Call `/return` only after the finalizer succeeds.',
    '- Do not call HR hiring, name-suggestion, or handoff tools in this phase.',
  ].join('\n');
}

function buildHrHiringPhaseSystemPrompt(basePrompt: string): string {
  return [
    basePrompt.trim(),
    '',
    '## Confirmed business context (strict)',
    '- Problem statement: {{business_definition.summary.problemStatement}}',
    '- Primary target users: {{business_definition.summary.primaryTargetUsers}}',
    '- Value proposition: {{business_definition.summary.valueProposition}}',
    '- Success criteria:',
    '  {{business_definition.summary.successCriteria}}',
    '- Constraints: {{business_definition.summary.constraints}}',
    '- Non-goals: {{business_definition.summary.nonGoals}}',
    '',
    '## Hiring completion contract (strict)',
    '- Prioritize hiring a Head of Development (or approved equivalent) with clear technical-delivery ownership.',
    '- Ensure this role reports directly to CEO {{hire_ceo.agentId}}.',
    '- Persist permissions for every hire using `access-set_permissions`.',
    '- Obtain explicit developer confirmation before attempting return.',
    '- Run `init-check_hiring_completion` to validate evidence.',
    '- Call `init-finalize_hiring_completion` only when check is complete.',
    '- Call `/return` only after the finalizer succeeds.',
  ].join('\n');
}

export const OnboardingWorkflowMetadata = {
  key: 'onboard_workflow',
  description: 'Run onboarding workflow through CEO and HR hiring phases with durable child interactions.',
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
 * After CEO provisioning, onboarding continues inside a durable CEO chat child
 * that must satisfy the business-definition completion contract before return.
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
      hrAgentId: state.hire_hr?.agentId,
      hrName: state.hire_hr?.name,
      businessSystemPrompt: state.prepare_context?.businessSystemPrompt,
      businessOpeningMessage: buildBusinessOpeningMessage(state),
      businessDefinition: state.business_definition,
      hiringCompletion: state.hr_hiring,
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
          const prepareContextRaw = await dispatchTool<
            Omit<OnboardingPreparationContext, 'businessPhaseSystemPrompt'>
          >(
            dispatcher,
            'init-prepare_onboarding',
            { workspaceRoot: state.workspaceRoot },
            ctx
          );
          const prepare_context: OnboardingPreparationContext = {
            ...prepareContextRaw,
            businessPhaseSystemPrompt: buildBusinessPhaseSystemPrompt(
              prepareContextRaw.businessSystemPrompt
            ),
            hrHiringPhaseSystemPrompt: buildHrHiringPhaseSystemPrompt(
              prepareContextRaw.planningSystemPrompt
            ),
          };
          return { ...state, prepare_context };
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
      {
        kind: 'chat',
        id: 'business_definition',
        agentId: '{{hire_ceo.agentId}}',
        chat: {
          systemPrompt: '{{prepare_context.businessPhaseSystemPrompt}}',
          toolPolicy: { allow: CEO_BUSINESS_TOOL_ALLOWLIST },
        },
        done: {
          command: 'init-check_business_definition',
          args: { workspaceRoot: '{{workspaceRoot}}' },
        },
        finalize: {
          command: 'init-finalize_business_definition',
          args: { workspaceRoot: '{{workspaceRoot}}' },
        },
        applyResult: (state, output) => ({
          ...state,
          business_definition: output as BusinessDefinitionFinalizedOutput,
        }),
      },
      {
        id: 'hr_names',
        execute: async (state, ctx) => {
          const hr_names = await dispatchTool<{ suggestions: string[] }>(
            dispatcher,
            'hr-name_suggestions',
            {
              roleLabel: 'HR Director',
              excludeNames: [state.hire_ceo?.name].filter((value): value is string => Boolean(value)),
              count: 5,
            },
            ctx
          );
          if (!hr_names.suggestions.length) {
            throw new Error('No HR Director name suggestions were generated.');
          }
          return { ...state, hr_names };
        },
      },
      {
        id: 'pick_hr',
        execute: async (state, ctx) => {
          const choices = (state.hr_names?.suggestions ?? []).map((candidate) => ({
            name: candidate,
            value: candidate,
          }));
          const pick_hr = await dispatchTool<{ type: string; kind: string; answer: string }>(
            dispatcher,
            'com-ask',
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
        execute: async (state, ctx) => {
          const hrName = state.pick_hr?.answer;
          if (!hrName) {
            throw new Error('HR Director selection is missing.');
          }
          const hire_hr = await dispatchTool<{ agentId: string; name: string; role: string }>(
            dispatcher,
            'hr-hire_agent',
            {
              name: hrName,
              role: 'hr-director',
              type: 'executive',
              contextLevel: 'organization',
              reportsTo: state.hire_ceo?.agentId,
              personality: {
                communication_style: 'strategic',
                expertise_level: 'executive',
                mentoring: true,
              },
              introduction: state.prepare_context!.hrIntroduction
                .replaceAll('{{pick_ceo.answer}}', state.hire_ceo?.name ?? state.pick_ceo?.answer ?? 'CEO')
                .replaceAll('{{pick_hr.answer}}', hrName),
              personalityProfile: state.prepare_context!.hrPersonalityProfile,
            },
            ctx
          );
          return { ...state, hire_hr };
        },
      },
      {
        id: 'hr_permissions',
        execute: async (state, ctx) => {
          if (!state.hire_hr?.agentId) {
            throw new Error('HR Director agent is missing for permission assignment.');
          }
          const hr_permissions = await dispatchTool<{ agentId: string }>(
            dispatcher,
            'access-set_permissions',
            {
              agentId: state.hire_hr.agentId,
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
        kind: 'chat',
        id: 'hr_hiring',
        agentId: '{{hire_hr.agentId}}',
        chat: {
          systemPrompt: '{{prepare_context.hrHiringPhaseSystemPrompt}}',
          toolPolicy: { allow: HR_HIRING_TOOL_ALLOWLIST },
        },
        done: {
          command: 'init-check_hiring_completion',
          args: {
            workspaceRoot: '{{workspaceRoot}}',
            ceoAgentId: '{{hire_ceo.agentId}}',
            hrAgentId: '{{hire_hr.agentId}}',
          },
        },
        finalize: {
          command: 'init-finalize_hiring_completion',
          args: {
            workspaceRoot: '{{workspaceRoot}}',
            ceoAgentId: '{{hire_ceo.agentId}}',
            hrAgentId: '{{hire_hr.agentId}}',
          },
        },
        applyResult: (state, output) => ({
          ...state,
          hr_hiring: output as HiringFinalizedOutput,
        }),
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
      hrAgentId: result.state.hire_hr?.agentId,
      hrName: result.state.hire_hr?.name,
      businessSystemPrompt: result.state.prepare_context?.businessSystemPrompt,
      businessOpeningMessage: buildBusinessOpeningMessage(result.state),
      businessDefinition: result.state.business_definition,
      hiringCompletion: result.state.hr_hiring,
    };

    return {
      status: 'ok',
      data,
    };
  }
}
