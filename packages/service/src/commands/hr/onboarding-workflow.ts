/**
 * Onboarding workflow — composes the founding-team onboarding flow from
 * generic tools: bootstrap files, name suggestion + selection, hire,
 * permission grant, chat phase, transcript save, handoff.
 *
 * The workflow definition is built per run by `createOnboardingWorkflowDefinition`
 * so workspace templates, developer name, and similar runtime context can be
 * embedded directly into step args.
 */

import type { ChatMessage } from '@ai-team/core';
import type { WorkflowDefinition, WorkflowStep } from '../../workflow/types.js';

export interface OnboardingWorkflowParams {
  workspaceRoot?: string;
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

const CEO_WRITE_PATTERNS = JSON.stringify([
  '.ai-team/**/*',
  '.github/copilot-instructions.md',
  'AGENTS.md',
  'docs/**/*',
]);
const HR_WRITE_PATTERNS = JSON.stringify([
  '.ai-team/**/*',
  '.ai-team/skills-catalog/**/*',
  '.github/skills/**/*',
  '.github/copilot-instructions.md',
  'AGENTS.md',
  'docs/**/*',
]);
const BROAD_READ = JSON.stringify(['**/*']);

/**
 * Build the onboarding workflow definition.
 *
 * The workflow resolves all runtime dependencies via tool steps:
 * - `init_bootstrap_files` seeds workspace templates/docs
 * - `init_prepare_onboarding` loads templates and derives prompt/introduction artifacts
 */
export function createOnboardingWorkflowDefinition(): WorkflowDefinition<OnboardingWorkflowState> {
  const steps: WorkflowStep<OnboardingWorkflowState>[] = [
    // 1. Seed workspace
    {
      id: 'bootstrap',
      command: 'init_bootstrap_files',
      args: { workspaceRoot: '{{workspaceRoot}}' },
    },

    // 2. Prepare onboarding prompt/introduction artifacts from templates
    {
      id: 'prepare_context',
      command: 'init_prepare_onboarding',
      args: { workspaceRoot: '{{workspaceRoot}}' },
    },

    // 3. Suggest 5 CEO names
    {
      id: 'ceo_names',
      command: 'hr_name_suggestions',
      args: { roleLabel: 'CEO', excludeNames: '[]', count: '5' },
    },

    // 4. User picks CEO name
    {
      id: 'pick_ceo',
      command: 'com_ask',
      args: {
        kind: 'select',
        message: 'Which candidate should we hire as CEO?',
        choices: {
          $map: {
            from: '{{ceo_names.suggestions}}',
            as: 'candidate',
            value: { name: '{{candidate}}', value: '{{candidate}}' },
          },
        },
      },
    },

    // 5. Create CEO agent
    {
      id: 'hire_ceo',
      command: 'hr_hire',
      args: {
        name: '{{pick_ceo.answer}}',
        role: 'ceo',
        type: 'executive',
        contextLevel: 'organization',
        personality: {
          communication_style: 'strategic',
          expertise_level: 'executive',
          mentoring: true,
        },
        introduction: '{{prepare_context.ceoIntroduction}}',
        personalityProfile: '{{prepare_context.ceoPersonalityProfile}}',
      },
    },

    // 6. Grant CEO permissions
    {
      id: 'ceo_permissions',
      command: 'access_set_permissions',
      args: {
        agentId: '{{hire_ceo.agentId}}',
        list: BROAD_READ,
        read: BROAD_READ,
        write: CEO_WRITE_PATTERNS,
      },
    },

    // 7. Business-definition chat with CEO
    {
      id: 'business_chat',
      command: 'chat_phase',
      args: {
        agentId: '{{hire_ceo.agentId}}',
        systemPrompt: '{{prepare_context.businessSystemPrompt}}',
        exitWords: JSON.stringify(['done', 'clear', 'finished']),
        toolAllowlist: JSON.stringify(['com_ask']),
      },
    },

    // 8. Save business chat transcript
    {
      id: 'business_transcript',
      command: 'docs_save_transcript',
      args: {
        relativePath: '.ai-team/business-definition.md',
        title: 'Business Definition',
        intro: [
          'This file captures the business-definition phase between the developer and CEO.',
          'It is generated by onboarding workflow step `business_transcript`.',
        ],
        messages: '{{business_chat.messages}}',
        agentLabel: '{{pick_ceo.answer}} (ceo)',
        developerLabel: '{{prepare_context.developerName}}',
      },
    },

    // 9. Ask: hire people or clarify business?
    {
      id: 'hire_choice',
      command: 'com_ask',
      args: {
        kind: 'select',
        message: 'What would you like to do next?',
        choices: [
          { name: 'Hire people now', value: 'hire' },
          { name: 'Skip hiring for now', value: 'skip' },
        ],
      },
    },

    // 10. Suggest HR names (only if hiring)
    {
      id: 'hr_names',
      command: 'hr_name_suggestions',
      when: '{{hire_choice.answer}} == "hire"',
      args: {
        roleLabel: 'Head of Human Resources',
        excludeNames: ['{{pick_ceo.answer}}'],
        count: 5,
      },
    },

    // 11. Pick HR name
    {
      id: 'pick_hr',
      command: 'com_ask',
      when: '{{hire_choice.answer}} == "hire"',
      args: {
        kind: 'select',
        message: 'Which candidate should we hire as HR Director?',
        choices: {
          $map: {
            from: '{{hr_names.suggestions}}',
            as: 'candidate',
            value: { name: '{{candidate}}', value: '{{candidate}}' },
          },
        },
      },
    },

    // 12. Create HR agent
    {
      id: 'hire_hr',
      command: 'hr_hire',
      when: '{{hire_choice.answer}} == "hire"',
      args: {
        name: '{{pick_hr.answer}}',
        role: 'hr-director',
        type: 'executive',
        contextLevel: 'organization',
        reportsTo: '{{hire_ceo.agentId}}',
        personality: {
          communication_style: 'supportive',
          expertise_level: 'executive',
          mentoring: true,
        },
        introduction: '{{prepare_context.hrIntroduction}}',
        personalityProfile: '{{prepare_context.hrPersonalityProfile}}',
      },
    },

    // 13. Grant HR permissions
    {
      id: 'hr_permissions',
      command: 'access_set_permissions',
      when: '{{hire_choice.answer}} == "hire"',
      args: {
        agentId: '{{hire_hr.agentId}}',
        list: BROAD_READ,
        read: BROAD_READ,
        write: HR_WRITE_PATTERNS,
      },
    },

    // 14. Summarize business chat for HR handoff (via llm_call)
    {
      id: 'hire_summary',
      command: 'llm_call',
      when: '{{hire_choice.answer}} == "hire"',
      args: {
        systemPrompt:
          'You summarize a business definition conversation into one concise paragraph (3-5 sentences). Focus on: business purpose, target users, technical direction. Return only the summary text.',
        userPrompt: 'Summarize this conversation transcript: {{business_chat.messages}}',
        maxTokens: 300,
        temperature: 0.5,
      },
    },

    // 15. Run hire sub-workflow with HR
    {
      id: 'hire_session',
      command: 'hire_workflow',
      when: '{{hire_choice.answer}} == "hire"',
      args: {
        hrAgentId: '{{hire_hr.agentId}}',
        requesterAgentId: '{{hire_ceo.agentId}}',
        instructions:
          `## Business context\n\n{{hire_summary.content}}\n\n` +
          `## Hire mandate\n\n{{prepare_context.planningSystemPrompt}}`,
        openingMessage:
          'Welcome {{pick_hr.answer}}. Read the hire request and start hiring the team. Use `hr_hire` for each new member, `access_set_permissions` to grant access, and say `done` when finished.',
      },
    },
  ];

  return {
    id: 'onboard_workflow',
    description: 'End-to-end founding-team onboarding: bootstrap, CEO, business chat, HR, hiring.',
    availableIn: { tool: true },
    group: 'hr',
    parameters: undefined,
    result: {
      ceoAgentId: '{{hire_ceo.agentId}}',
      ceoName: '{{pick_ceo.answer}}',
      hrAgentId: '{{hire_hr.agentId}}',
      hrName: '{{pick_hr.answer}}',
      businessTranscriptPath: '{{business_transcript.filePath}}',
      hireMessages: {
        $coalesce: ['{{hire_session.messages}}', []],
      },
    },
    steps,
  };
}
