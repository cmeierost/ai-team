import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  ChatMessage,
} from '@ai-team/core';
import type { ChatRuntimeHooks } from '../../orchestrator/hooks.js';
import type { SessionManager } from '../../session-manager.js';
import type { ChatCommand } from '../chat/chat.command.js';
import type { IQuestionService } from '../../questions/question-service.js';

const chatPhaseParamsSchema = z.object({
  agentId: z.string().min(1).describe('Agent that runs this chat phase.'),
  systemPrompt: z
    .string()
    .min(1)
    .describe(
      'Workflow system prompt appended to the agent. Defines the goal and exit conditions of this phase.'
    ),
  exitWords: z
    .array(z.string().min(1))
    .min(1)
    .describe('User-input words that end the phase and return control to the workflow.'),
  toolAllowlist: z
    .array(z.string())
    .optional()
    .describe(
      'Canonical tool keys (e.g. "com_ask") the agent may use during this phase. When omitted, the agent\'s default tool set is used.'
    ),
  openingMessage: z
    .string()
    .optional()
    .describe(
      "Optional message the agent says first to kick off the phase. When omitted, the agent's normal introduction runs."
    ),
});

export type ChatPhaseParams = z.infer<typeof chatPhaseParamsSchema>;

export interface ChatPhaseResult {
  messages: ChatMessage[];
}

export const ChatPhaseCommandMetadata = {
  key: 'phase',
  group: 'chat',
  description:
    'Run a bounded chat phase with a specific agent: applies a workflow system prompt, restricts tools, and exits when the user types one of the exit words. Returns the message history of the phase.',
  availableIn: { tool: true },
  parameters: chatPhaseParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'chat', 'workflow'],
} satisfies ICommandDescriptor;

/**
 * `chat_phase` — a bounded chat session embedded in a workflow.
 *
 * Self-contained: the workflow runner does NOT interrupt this step to ask for
 * missing parameters. The agent handles all interaction until the user types
 * an exit word.
 *
 * After exit, returns the full message history of the phase so subsequent
 * workflow steps can save transcripts, summarize, etc.
 */
export class ChatPhaseCommand implements ICommand<ChatPhaseParams, ChatPhaseResult> {
  readonly metadata = ChatPhaseCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly chatCommand: Pick<ChatCommand, 'execute'>,
    private readonly sessionManager: Pick<
      SessionManager,
      'getLatestSession' | 'getSessionMessages'
    >,
    private readonly questionService: IQuestionService
  ) {}

  async execute(
    params: ChatPhaseParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<ChatPhaseResult>> {
    const hooks: ChatRuntimeHooks = {
      invocationSurface: ctx.invocationSurface,
      signal: ctx.signal,
      questionInput: (request) => this.questionService.input(request),
      questionConfirm: (request) => this.questionService.confirm(request),
      questionSelect: (request) => this.questionService.select(request),
      questionPassword: (request) => this.questionService.password(request),
      questionChecklist: (request) => this.questionService.checklist(request),
      workflowState: ctx.workflowState as ChatRuntimeHooks['workflowState'],
      onWorkflowFrame: ctx.onWorkflowFrame,
    };

    await this.chatCommand.execute(
      this.workspaceRoot,
      params.agentId,
      {
        createNewSession: true,
        workflowMode: true,
        workflowSystemPrompt: params.systemPrompt,
        workflowExitWords: params.exitWords,
        suppressAutoIntroduction: params.openingMessage !== undefined,
        pendingIntroduction: params.openingMessage,
        toolPolicy: params.toolAllowlist ? { allow: params.toolAllowlist } : undefined,
        disableProcessExit: true,
      },
      hooks
    );

    const messages = await this.collectPhaseMessagesAsync(params.agentId);
    return { status: 'ok', data: { messages } };
  }

  private async collectPhaseMessagesAsync(agentId: string): Promise<ChatMessage[]> {
    const latestSession = await this.sessionManager.getLatestSession(agentId);
    if (!latestSession) return [];
    return this.sessionManager.getSessionMessages(latestSession.id);
  }
}
