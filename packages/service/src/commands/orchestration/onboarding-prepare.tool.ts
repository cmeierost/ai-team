import { z } from 'zod';
import type {
  ICommand,
  ICommandDescriptor,
  CommandResponse,
  ExecutionContext,
  IDeveloperIdentityService,
} from '@ai-team/core';
import {
  getOnboardingPhase,
  loadOnboardingWorkflowDefinitionFromTemplates,
} from '../init/onboarding-workflow-definition.js';
import {
  loadInitTemplates,
  parseTemplateBulletList,
  renderTemplate,
} from '../init/template-utils.js';

const prepareOnboardingParamsSchema = z.object({
  workspaceRoot: z
    .string()
    .optional()
    .describe('Workspace root used to load onboarding templates. Defaults to execution context.'),
});

export type PrepareOnboardingParams = z.infer<typeof prepareOnboardingParamsSchema>;

export interface PrepareOnboardingResult {
  developerName?: string;
  businessSystemPrompt: string;
  planningSystemPrompt: string;
  ceoIntroduction: string;
  hrIntroduction: string;
  ceoPersonalityProfile: string[];
  hrPersonalityProfile: string[];
}

export const PrepareOnboardingCommandMetadata = {
  key: 'prepare_onboarding',
  group: 'init',
  description:
    'Load onboarding templates and derive runtime prompt/context artifacts (phase prompts, intros, and personality profiles).',
  availableIn: { tool: true },
  parameters: prepareOnboardingParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'init', 'workflow'],
} satisfies ICommandDescriptor;

export class PrepareOnboardingCommand implements ICommand<
  PrepareOnboardingParams,
  PrepareOnboardingResult
> {
  readonly metadata = PrepareOnboardingCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly developerIdentityService: IDeveloperIdentityService
  ) {}

  async execute(
    params: PrepareOnboardingParams,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<PrepareOnboardingResult>> {
    const workspaceRoot = params.workspaceRoot ?? this.workspaceRoot;
    if (!workspaceRoot) {
      return { status: 'error', message: 'init_prepare_onboarding requires a workspaceRoot.' };
    }

    const templates = await loadInitTemplates(workspaceRoot);
    const developerName = this.developerIdentityService.getUserName();

    const onboardingPhases = loadOnboardingWorkflowDefinitionFromTemplates({
      templates,
      ceoName: '{{ceoName}}',
      hrName: '{{hrName}}',
      developerName,
    });

    const businessPhase = getOnboardingPhase(onboardingPhases, 'business-definition');
    const planningPhase = getOnboardingPhase(onboardingPhases, 'team-planning');

    const ceoIntroduction = renderTemplate(templates.ceoAgentIntroduction, {
      ceoName: '{{pick_ceo.answer}}',
      hrName: 'HR Director',
    }).trim();

    const hrIntroduction = renderTemplate(templates.hrAgentIntroduction, {
      ceoName: '{{pick_ceo.answer}}',
      hrName: '{{pick_hr.answer}}',
    }).trim();

    return {
      status: 'ok',
      data: {
        developerName,
        businessSystemPrompt: buildPhaseSystemPrompt(businessPhase),
        planningSystemPrompt: buildPhaseSystemPrompt(planningPhase),
        ceoIntroduction,
        hrIntroduction,
        ceoPersonalityProfile: parseTemplateBulletList(templates.ceoAgentPersonality),
        hrPersonalityProfile: parseTemplateBulletList(templates.hrAgentPersonality),
      },
    };
  }
}

function buildPhaseSystemPrompt(phase: { strictSystemPrompt: string; goal: string }): string {
  return [
    phase.strictSystemPrompt.trim(),
    '## Workflow goal (strict)',
    phase.goal,
    '',
    '## Runtime contract',
    '- Stay in role and keep this phase focused on its goal.',
    '- If the developer indicates completion, give a concise recap and let them continue.',
    '- Keep responses concise and decision-oriented by default.',
  ]
    .join('\n')
    .trim();
}
