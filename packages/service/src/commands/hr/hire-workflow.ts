import { z } from 'zod';
import type {
  ChatMessage,
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
} from '@ai-team/core';
import type { WorkflowDefinition, WorkflowStep, IWorkflowRunnerFactory } from '../../workflow/index.js';

/**
 * Input parameters for the `hire` sub-workflow.
 *
 * - `hrAgentId`        — HR agent running the workflow chat phase (typically the HR Director)
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
  openingInstruction?: string;
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

const hireCompletionParamsSchema = z.object({
  exitWords: z.array(z.string().min(1)).optional(),
});

export const CheckHireWorkflowCompletionMetadata = {
  key: 'check_hire_workflow_completion',
  group: 'hr',
  description: 'Check whether the HR hire workflow conversation is ready to return.',
  availableIn: { tool: true },
  parameters: hireCompletionParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'hr', 'workflow'],
} satisfies ICommandDescriptor;

const finalizeHireWorkflowParamsSchema = z.object({});

export const FinalizeHireWorkflowMetadata = {
  key: 'finalize_hire_workflow',
  group: 'hr',
  description: 'Finalize the HR hire workflow and return the full conversation transcript.',
  availableIn: { tool: true },
  parameters: finalizeHireWorkflowParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'hr', 'workflow'],
} satisfies ICommandDescriptor;

function isAssistantMessage(message: ChatMessage): boolean {
  return message.isHuman !== true && message.from !== 'human';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasCompletionWord(text: string, words: string[]): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return words.some((word) => {
    const normalized = word.trim();
    if (!normalized) return false;
    const matcher = new RegExp(`\\b${escapeRegExp(normalized)}[.!?]*$`, 'i');
    return matcher.test(trimmed);
  });
}

export class CheckHireWorkflowCompletionCommand implements ICommand<
  z.infer<typeof hireCompletionParamsSchema>,
  { done: boolean; feedback?: string }
> {
  readonly metadata = CheckHireWorkflowCompletionMetadata;

  constructor(
    private readonly getSessionMessages: (sessionId: string) => Promise<ChatMessage[]>
  ) {}

  async execute(
    params: z.infer<typeof hireCompletionParamsSchema>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<{ done: boolean; feedback?: string }>> {
    if (!ctx.sessionId) {
      return {
        status: 'ok',
        data: {
          done: false,
          feedback: 'No active workflow chat session is available yet.',
        },
      };
    }
    const messages = await this.getSessionMessages(ctx.sessionId);
    const lastAssistant = [...messages].reverse().find(isAssistantMessage);
    const exitWords = params.exitWords?.length ? params.exitWords : ['done'];
    const done = Boolean(lastAssistant?.content && hasCompletionWord(lastAssistant.content, exitWords));
    return {
      status: 'ok',
      data: done
        ? { done: true }
        : {
            done: false,
            feedback:
              `Return was rejected. Finish hiring, apply permissions, then end the HR response with ` +
              `'${exitWords[0] ?? 'done'}'.`,
          },
    };
  }
}

export class FinalizeHireWorkflowCommand implements ICommand<
  z.infer<typeof finalizeHireWorkflowParamsSchema>,
  { messages: ChatMessage[] }
> {
  readonly metadata = FinalizeHireWorkflowMetadata;

  constructor(
    private readonly getSessionMessages: (sessionId: string) => Promise<ChatMessage[]>
  ) {}

  async execute(
    _params: z.infer<typeof finalizeHireWorkflowParamsSchema>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<{ messages: ChatMessage[] }>> {
    if (!ctx.sessionId) {
      return { status: 'error', message: 'Cannot finalize hire workflow without an active session.' };
    }
    const messages = await this.getSessionMessages(ctx.sessionId);
    return { status: 'ok', data: { messages } };
  }
}

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
 * Hire workflow - OOP design for extensibility.
 * 
 * To extend this workflow:
 * 1. Extend this class
 * 2. Override createSteps() to reorder or add steps
 * 3. Override individual step methods (createHrChatStep) to customize behavior
 * 
 * @example
 * class CustomHireWorkflow extends HireWorkflow {
 *   createSteps() {
 *     return [
 *       this.createPreApprovalStep(),  // Add new step before
 *       this.createHrChatStep(),        // Keep existing
 *       this.createNotificationStep()   // Add new step after
 *     ];
 *   }
 * }
 */
export class HireWorkflow {
  constructor() {}

  getDefinition(): WorkflowDefinition<HireWorkflowState> {
    return {
      id: HireWorkflowMetadata.key,
      version: '1',
      description: HireWorkflowMetadata.description,
      availableIn: HireWorkflowMetadata.availableIn,
      prepare: (params: unknown) => this.prepare(params),
      toResult: (state: HireWorkflowState) => this.toResult(state),
      steps: this.createSteps(),
    };
  }

  protected prepare(params: unknown): HireWorkflowState {
    const validated = hireWorkflowParamsSchema.parse(params);
    return {
      ...(validated as HireWorkflowState),
      openingInstruction: validated.openingMessage?.trim()
        ? `If this is the first turn, start your first response with: "${validated.openingMessage.trim()}".`
        : '',
    };
  }

  protected toResult(state: HireWorkflowState): HireWorkflowResult {
    return {
      messages: state.hr_chat?.messages ?? [],
    };
  }

  protected createSteps(): WorkflowStep<HireWorkflowState>[] {
    return [this.createHrChatStep()];
  }

  protected createHrChatStep(): WorkflowStep<HireWorkflowState> {
    return {
      kind: 'chat',
      id: 'hr_chat',
      agentId: '{{hrAgentId}}',
      chat: {
        systemPrompt: `${hireSystemPrompt}\n\n{{openingInstruction}}`,
        toolPolicy: { allow: ['hr-hire_agent', 'com-ask', 'access-set_permissions'] },
      },
      done: {
        command: 'hr-check_hire_workflow_completion',
        args: { exitWords: ['done'] },
      },
      finalize: {
        command: 'hr-finalize_hire_workflow',
      },
      applyResult: (state, output) => ({
        ...state,
        hr_chat: output as { messages: ChatMessage[] },
      }),
    };
  }

  asCommand(factory: IWorkflowRunnerFactory): ICommand {
    return factory.asCommand(this.getDefinition());
  }
}

/**
 * Legacy command wrapper for backward compatibility.
 */
export class HireWorkflowCommand implements ICommand<HireWorkflowParams, HireWorkflowResult> {
  readonly metadata = HireWorkflowMetadata;
  private readonly workflow: HireWorkflow;

  constructor(private readonly workflowRunnerFactory: IWorkflowRunnerFactory) {
    this.workflow = new HireWorkflow();
  }

  async execute(
    params: HireWorkflowParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<HireWorkflowResult>> {
    const initialState: HireWorkflowState = {
      ...params,
    };

    const result = await this.workflowRunnerFactory.create().run(this.workflow.getDefinition(), initialState, {
      signal: ctx.signal,
      executionContext: ctx,
    });

    return {
      status: 'ok',
      data: {
        messages: result.state.hr_chat?.messages ?? [],
      },
    };
  }
}
