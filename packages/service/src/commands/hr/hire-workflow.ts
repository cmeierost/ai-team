import { z } from 'zod';
import type { ChatMessage, ICommandDescriptor } from '@ai-team/core';
import type { WorkflowDefinition } from '../../workflow/types.js';

/**
 * Input parameters for the `hire` sub-workflow.
 *
 * - `hrAgentId`        — HR agent running the chat phase (typically the HR Director)
 * - `requesterAgentId` — Manager/CTO requesting the hire (used in the system prompt)
 * - `instructions`     — Free-form context describing what to hire for
 * - `openingMessage`   — Optional handoff message HR says first
 */
const hireWorkflowParamsSchema = z.object({
  hrAgentId: z.string().min(1).describe('HR agent id that conducts the hire conversation.'),
  requesterAgentId: z
    .string()
    .optional()
    .describe('Agent id of the requesting manager (CTO, CEO, etc.).'),
  instructions: z
    .string()
    .min(1)
    .describe('What to hire for — roles, constraints, priorities, technical context.'),
  openingMessage: z
    .string()
    .optional()
    .describe('Initial message HR says to open the conversation.'),
});

export type HireWorkflowParams = z.infer<typeof hireWorkflowParamsSchema>;

export interface HireWorkflowState extends HireWorkflowParams {
  hr_chat?: { messages: ChatMessage[] };
}

export interface HireWorkflowResult {
  messages: ChatMessage[];
}

const hireSystemPrompt = `You are the HR Director conducting a hire interview.

Your goal: identify what new team members are needed and create them.

## Process
1. Read the hire request below carefully.
2. If the request is clear, propose specific role(s) to hire (name, role, specializations, reportsTo).
3. If anything is ambiguous, use \`com_ask\` to clarify with the requester.
4. When you have a clear hire, call \`hr_hire\` with the parameters. You may call it multiple times if multiple roles are needed.
5. After each successful hire, call \`set_permissions\` to grant the new agent appropriate access patterns.
6. When all needed hires are done, end your message with the word: done

## Hire request

{{instructions}}

## Runtime contract
- Stay focused on hiring. Do not drift into design or implementation discussions.
- Be specific with names and roles. Use \`com_ask\` if a name should come from the requester.
- Permission defaults: list/read \`['**/*']\`, write usually limited (e.g. \`['docs/**/*', '.ai-team/agents/**/*']\`).
`;

export const HireWorkflowMetadata = {
  key: 'hire_workflow',
  group: 'hr',
  description:
    'Run an HR-led hiring conversation. The HR agent reads the request, may ask clarifying questions, and calls `hr_hire` + `set_permissions` for each new team member. Returns the conversation transcript.',
  availableIn: { tool: true },
  parameters: hireWorkflowParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'hr', 'workflow'],
} satisfies ICommandDescriptor;

/**
 * `hire_workflow` — a focused chat phase with the HR Director where the
 * HR agent uses `hr_hire` and `set_permissions` tools to create new agents.
 *
 * This is a thin workflow: a single `chat_phase` step with a hire-focused
 * system prompt and a tool allowlist that includes only the tools relevant
 * to hiring.
 */
export const hireWorkflowDefinition: WorkflowDefinition<HireWorkflowState> = {
  id: HireWorkflowMetadata.key,
  description: HireWorkflowMetadata.description,
  availableIn: HireWorkflowMetadata.availableIn,
  group: HireWorkflowMetadata.group,
  parameters: hireWorkflowParamsSchema,
  tags: HireWorkflowMetadata.tags,
  prepare: (params) => params as HireWorkflowState,
  result: {
    messages: {
      $coalesce: ['{{hr_chat.messages}}', []],
    },
  },
  steps: [
    {
      id: 'hr_chat',
      command: 'chat_phase',
      args: {
        agentId: '{{hrAgentId}}',
        systemPrompt: hireSystemPrompt,
        exitWords: JSON.stringify(['done']),
        toolAllowlist: JSON.stringify(['hr_hire', 'com_ask', 'access_set_permissions']),
        openingMessage: '{{openingMessage}}',
      },
    },
  ],
};
