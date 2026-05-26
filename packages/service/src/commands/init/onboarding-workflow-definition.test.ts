import { describe, expect, it } from 'vitest';
import type { InitTemplates } from './template-utils.js';
import {
  getOnboardingPhase,
  loadOnboardingWorkflowDefinitionFromTemplates,
} from './onboarding-workflow-definition.js';

function createTemplates(onboardingWorkflowDefinition: string): InitTemplates {
  return {
    nameSystemPrompt: '',
    nameRequestPrompt: '',
    nameRequestStrictPrompt: '',
    ceoAgentIntroduction: '',
    ceoAgentPersonality: '',
    hrAgentIntroduction: '',
    hrAgentPersonality: '',
    onboardingCeoSystemPrompt: '',
    onboardingHrSystemPrompt: '',
    onboardingWorkflowDefinition,
    bootstrapAgentsFile: '',
    bootstrapCopilotInstructionsFile: '',
    bootstrapAiTeamWayFile: '',
    instructionsAgentsFile: '',
    instructionsAgentMetadataFile: '',
    instructionsSkillsFile: '',
    instructionsPromptsFile: '',
    skillAgentAuthoringFile: '',
    roleCeoFile: '',
    roleHrDirectorFile: '',
    roleChiefArchitectFile: '',
    docsArchitectureOverviewFile: '',
    docsArchitectureDiagramsFile: '',
    docsRequirementsTraceabilityFile: '',
    docsApiContractsFile: '',
    aiTeamReadmeFile: '',
  };
}

describe('onboarding workflow definition', () => {
  it('loads a CEO-first strict workflow definition and resolves phases', () => {
    const templates = createTemplates(`
version: 1
phases:
  - id: business-definition
    agentRole: ceo
    heading: Business Definition
    introLines:
      - "{{ceoName}} starts"
    goal: Align business plan
    strictSystemPrompt: |
      You are {{ceoName}}, CEO.
    exitWords:
      - done
    suppressAutoIntroduction: true
    transcript:
      relativePath: .ai-team/business.md
      title: Business Definition
      intro:
        - "> business"

  - id: team-planning
    agentRole: hr-director
    heading: Team Planning
    introLines:
      - "{{hrName}} starts"
    goal: Define hiring wave
    strictSystemPrompt: |
      You are {{hrName}}, HR Director.
    exitWords:
      - done
    suppressAutoIntroduction: true
    transcript:
      relativePath: .ai-team/meetings/team-planning.md
      title: Team Planning
      intro:
        - "> planning"
`);

    const definition = loadOnboardingWorkflowDefinitionFromTemplates({
      templates,
      ceoName: 'Michael Brown',
      hrName: 'Emily Davis',
      developerName: 'dev',
    });

    const business = getOnboardingPhase(definition, 'business-definition');
    const planning = getOnboardingPhase(definition, 'team-planning');

    expect(business.agentRole).toBe('ceo');
    expect(business.strictSystemPrompt).toContain('Michael Brown');
    expect(planning.strictSystemPrompt).toContain('Emily Davis');
  });

  it('rejects definitions that do not start with CEO', () => {
    const templates = createTemplates(`
version: 1
phases:
  - id: business-definition
    agentRole: hr-director
    heading: Wrong Start
    introLines: []
    goal: test
    strictSystemPrompt: test
    exitWords: [done]
    suppressAutoIntroduction: true
    transcript:
      relativePath: .ai-team/business.md
      title: Business Definition
      intro: []
  - id: team-planning
    agentRole: hr-director
    heading: Team Planning
    introLines: []
    goal: test
    strictSystemPrompt: test
    exitWords: [done]
    suppressAutoIntroduction: true
    transcript:
      relativePath: .ai-team/meetings/team-planning.md
      title: Team Planning
      intro: []
`);

    expect(() =>
      loadOnboardingWorkflowDefinitionFromTemplates({
        templates,
        ceoName: 'CEO',
        hrName: 'HR',
      })
    ).toThrow(/first onboarding phase must start with the CEO/i);
  });
});
