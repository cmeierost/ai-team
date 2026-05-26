import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  IAgentManager,
} from '@ai-team/core';
import type { ChatRuntimeHooks } from '../../orchestrator/hooks.js';
import { ChatInfoService } from '../../orchestrator/chat-info-service.js';
import type { IChatInfoService } from '../../orchestrator/chat-info-service.js';
import { ChatPreflightService } from '../../orchestrator/chat-preflight-service.js';
import { EmitService } from '../../orchestrator/services/emit-service.js';
import { InfoChatCommand } from '../agents/info.command.js';
import {
  ChatCommand,
  type ChatConfigIdentityDeps,
  type ChatAgentKnowledgeDeps,
  type ChatSessionExecutionDeps,
  type ChatOrchestrationDeps,
} from './chat.command.js';
import type { IQuestionService } from '../../questions/question-service.js';

type Params = z.infer<typeof ChatICommand.schema>;
const _chatICommandSchema = z.object({
  employeeId: z.string().optional().describe('Agent id, name, or role query'),
  options: z
    .object({
      message: z.string().optional(),
      context: z.array(z.string()).optional(),
      mediatorLog: z.boolean().optional(),
      new: z.boolean().optional(),
      sessionId: z.string().optional(),
    })
    .optional()
    .default({}),
});

export const ChatCommandMetadata = {
  key: 'chat' as const,
  description: 'Start a chat session with an agent',
  availableIn: { cli: true, chat: false, tool: false },
  group: 'chat',
  parameters: _chatICommandSchema,
} satisfies ICommandDescriptor;

export class ChatICommand implements ICommand<Params, void> {
  static readonly schema = _chatICommandSchema;
  readonly metadata = ChatCommandMetadata;

  constructor(
    private readonly configIdentityDeps: ChatConfigIdentityDeps,
    private readonly agentKnowledgeDeps: ChatAgentKnowledgeDeps,
    private readonly sessionExecutionDeps: ChatSessionExecutionDeps,
    private readonly orchestrationDeps: ChatOrchestrationDeps,
    private readonly chatInfoService: IChatInfoService = new ChatInfoService(
      EmitService.forConsole()
    ),
    private readonly questionService: IQuestionService
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    let { employeeId } = payload;
    const rawOptions = payload.options ?? {};
    const options: typeof rawOptions & { createNewSession?: boolean } = {
      ...rawOptions,
      // `new` is the CLI flag; ChatCommand uses `createNewSession`
      createNewSession: rawOptions.new,
    };

    // When no agent is specified and no session is pinned, jump back to the
    // most recently active session regardless of which agent it belongs to.
    if (!employeeId && !options.sessionId && !options.new) {
      const recent = await this.sessionExecutionDeps.sessionManager.listRecentSessions(1);
      if (recent.length > 0) {
        const last = recent[0];
        employeeId = last.agentId;
        options.sessionId = last.id;
      }
    }

    const hooks: ChatRuntimeHooks = {
      invocationSurface: ctx.invocationSurface,
      signal: ctx.signal,
      questionInput: (request) => this.questionService.input(request),
      questionConfirm: (request) => this.questionService.confirm(request),
      questionSelect: (request) => this.questionService.select(request),
      questionPassword: (request) => this.questionService.password(request),
      questionChecklist: (request) => this.questionService.checklist(request),
      workflowState: ctx.workflowState as
        | import('@ai-team/api-contracts').WorkflowStateSnapshot
        | undefined,
      onWorkflowFrame: ctx.onWorkflowFrame,
    };

    const cmd = new ChatCommand(
      this.configIdentityDeps,
      this.agentKnowledgeDeps,
      this.sessionExecutionDeps,
      this.orchestrationDeps,
      this.chatInfoService,
      new ChatPreflightService(
        this.configIdentityDeps.configurationStorage,
        this.configIdentityDeps.environmentStorage,
        this.configIdentityDeps.developerIdentityService,
        EmitService.forConsole()
      ),
      new InfoChatCommand(
        this.agentKnowledgeDeps.agentManager as unknown as IAgentManager,
        this.questionService
      )
    );

    await cmd.execute(ctx.workspaceRoot, employeeId, options, hooks);
    return { status: 'ok' };
  }
}
