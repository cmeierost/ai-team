import { z } from 'zod';
import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { ChatRuntimeHooks } from '../../orchestrator/hooks.js';
import { ChatInfoService } from '../../orchestrator/chat-info-service.js';
import type { IChatInfoService } from '../../orchestrator/chat-info-service.js';
import { ChatPreflightService } from '../../orchestrator/chat-preflight-service.js';
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

export class ChatICommand implements ICommand<Params, void> {
  static readonly schema = z.object({
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

  readonly key = 'chat' as const;
  readonly cli = { command: 'chat [agent-id]' };
  readonly description = 'Start a chat session with an agent';
  readonly availableIn = { cli: true, chat: false, tool: false };
  readonly group = 'chat';
  readonly parameters = ChatICommand.schema;

  constructor(
    private readonly configIdentityDeps: ChatConfigIdentityDeps,
    private readonly agentKnowledgeDeps: ChatAgentKnowledgeDeps,
    private readonly sessionExecutionDeps: ChatSessionExecutionDeps,
    private readonly orchestrationDeps: ChatOrchestrationDeps,
    private readonly chatInfoService: IChatInfoService = new ChatInfoService(),
    private readonly questionService: IQuestionService
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const hooks: ChatRuntimeHooks = {
      invocationSurface: ctx.invocationSurface,
      signal: ctx.signal,
      emit: ctx.emit,
      questionInput: (request) => this.questionService.questionInput(request),
      questionConfirm: (request) => this.questionService.questionConfirm(request),
      questionSelect: (request) => this.questionService.questionSelect(request),
      questionPassword: (request) => this.questionService.questionPassword(request),
      questionChecklist: (request) => this.questionService.questionChecklist(request),
      workflowState: ctx.workflowState as import('@ai-team/api-contracts').WorkflowStateSnapshot | undefined,
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
        this.configIdentityDeps.developerIdentityService
      ),
      new InfoChatCommand(
        this.agentKnowledgeDeps.agentManager as unknown as import('@ai-team/core').IAgentManager,
        this.questionService
      )
    );

    await cmd.execute(ctx.workspaceRoot, payload.employeeId, payload.options ?? {}, hooks);
    return { status: 'ok' };
  }
}
