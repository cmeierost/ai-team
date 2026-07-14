import { z } from 'zod';
import type {
  Agent,
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  IDeveloperIdentityService,
} from '@ai-team/core';
import { type IChatInfoService } from './chat-info-service.js';
import { runChatSessionStartup, type ChatSessionStartupResult } from './chat-session-startup.js';
import { ResolveChatSessionCommand } from './resolve-chat-session.command.js';
import { LoadSessionMessagesCommand } from './load-session-messages.command.js';
import { IntroductionCommand } from './introduction.command.js';

const chatStartupParamsSchema = z.object({
  employeeId: z.string().optional(),
  options: z.object({
    sessionId: z.string().optional(),
    createNewSession: z.boolean().optional(),
    introduction: z.boolean().optional(),
  }),
});

type ChatStartupParams = z.infer<typeof chatStartupParamsSchema>;

export class ChatStartupCommand implements ICommand<ChatStartupParams, string> {
  static readonly metadata = {
    key: 'chat-startup' as const,
    description: 'Run chat startup (session/bootstrap/history) without starting interactive input',
    availableIn: { cli: false, chat: false, tool: false },
    group: 'chat',
    parameters: chatStartupParamsSchema,
  } satisfies ICommandDescriptor;

  readonly metadata = ChatStartupCommand.metadata;

  constructor(
    private readonly agentManager: {
      getAgentAsync: (agentId: string) => Promise<Agent | null | undefined>;
    },
    private readonly resolveChatSessionCommand: ResolveChatSessionCommand,
    private readonly loadSessionMessagesCommand: LoadSessionMessagesCommand,
    private readonly introductionCommand: IntroductionCommand,
    private readonly chatInfoService: IChatInfoService,
    private readonly developerIdentityService: Pick<IDeveloperIdentityService, 'getUserName'>
  ) {}

  async execute(
    payload: ChatStartupParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<string>> {
    if (!payload.employeeId) {
      return { status: 'ok', data: '', message: 'completed' };
    }

    const agent = await this.agentManager.getAgentAsync(payload.employeeId);
    if (!agent) {
      return {
        status: 'error',
        message: `Agent '${payload.employeeId}' not found`,
      };
    }

    const developerName = this.developerIdentityService.getUserName() ?? 'Developer';

    this.chatInfoService.showSessionIntro({
      agent,
      developerName,
    });

    const startup: ChatSessionStartupResult = await runChatSessionStartup(
      {
        agent,
        options: {
          sessionId: payload.options.sessionId,
          createNewSession: payload.options.createNewSession,
          introduction: payload.options.introduction,
        },
        developerName,
      },
      {
        resolveChatSessionCommand: this.resolveChatSessionCommand,
        loadSessionMessagesCommand: this.loadSessionMessagesCommand,
        introductionCommand: this.introductionCommand,
      },
      {
        history: [],
        signal: ctx.signal,
        invocationSurface: ctx.invocationSurface,
        workflowState: ctx.workflowState,
      }
    );

    this.chatInfoService.showSessionResume(startup.history, agent.name, developerName);

    return { status: 'ok', data: '', message: 'completed' };
  }
}
