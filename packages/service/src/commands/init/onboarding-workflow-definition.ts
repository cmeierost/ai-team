import { z } from 'zod';
import { workflowDefinitionYamlToJson } from '../../workflow/definition-format.js';
import { renderTemplate, type InitTemplates } from './template-utils.js';

const onboardingWorkflowPhaseSchema = z.object({
  id: z.enum(['business-definition', 'team-planning']),
  agentRole: z.enum(['ceo', 'hr-director']),
  heading: z.string().min(1),
  introLines: z.array(z.string()).default([]),
  goal: z.string().min(1),
  strictSystemPrompt: z.string().min(1),
  exitWords: z.array(z.string().min(1)).min(1),
  suppressAutoIntroduction: z.boolean().default(true),
  transcript: z.object({
    relativePath: z.string().min(1),
    title: z.string().min(1),
    intro: z.array(z.string()).default([]),
  }),
});

const onboardingWorkflowDefinitionSchema = z
  .object({
    version: z.number().int().positive(),
    phases: z.array(onboardingWorkflowPhaseSchema).min(2),
  })
  .superRefine((value, ctx) => {
    if (value.phases[0]?.agentRole !== 'ceo') {
      ctx.addIssue({
        code: 'custom',
        path: ['phases', 0, 'agentRole'],
        message: 'The first onboarding phase must start with the CEO.',
      });
    }

    const businessPhase = value.phases.find((phase) => phase.id === 'business-definition');
    const planningPhase = value.phases.find((phase) => phase.id === 'team-planning');

    if (!businessPhase) {
      ctx.addIssue({
        code: 'custom',
        path: ['phases'],
        message: 'Missing required onboarding phase: business-definition.',
      });
    }

    if (!planningPhase) {
      ctx.addIssue({
        code: 'custom',
        path: ['phases'],
        message: 'Missing required onboarding phase: team-planning.',
      });
    }
  });

export type OnboardingWorkflowDefinition = z.infer<typeof onboardingWorkflowDefinitionSchema>;
export type OnboardingWorkflowPhase = z.infer<typeof onboardingWorkflowPhaseSchema>;

export interface LoadOnboardingWorkflowDefinitionParams {
  templates: InitTemplates;
  ceoName: string;
  hrName: string;
  developerName?: string;
}

export function loadOnboardingWorkflowDefinitionFromTemplates(
  params: LoadOnboardingWorkflowDefinitionParams
): OnboardingWorkflowDefinition {
  const renderedDefinition = renderTemplate(params.templates.onboardingWorkflowDefinition, {
    ceoName: params.ceoName,
    hrName: params.hrName,
    developerName: params.developerName ?? 'developer',
  });

  const parsedDefinition = workflowDefinitionYamlToJson(renderedDefinition);
  return onboardingWorkflowDefinitionSchema.parse(parsedDefinition);
}

export function getOnboardingPhase(
  definition: OnboardingWorkflowDefinition,
  phaseId: OnboardingWorkflowPhase['id']
): OnboardingWorkflowPhase {
  const phase = definition.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) {
    throw new Error(`Onboarding workflow is missing phase: ${phaseId}`);
  }
  return phase;
}
