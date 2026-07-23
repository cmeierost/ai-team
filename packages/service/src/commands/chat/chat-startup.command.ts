import { z } from 'zod';
import type {
  CommandResponse,
  ExecutionContext,
  ICommand,
  ICommandDescriptor,
  IDeveloperIdentityService,
  ISystemInfoService,
} from '@ai-team/core';
import { type IChatInfoService } from './chat-info-service.js';
import { runChatSessionStartup, type ChatSessionStartupResult } from './chat-session-startup.js';
import { ResolveChatSessionCommand } from './resolve-chat-session.command.js';
import { LoadSessionMessagesCommand } from './load-session-messages.command.js';
import { IntroductionCommand } from './introduction.command.js';
import { ChatThreadTranscriptService } from './chat-thread-transcript.js';
import type { AgentRuntimeIdentityResolver } from './agent-runtime-identity.js';
import { ChatStartupTargetResolver } from './chat-startup-target-resolver.js';

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
    private readonly resolveChatSessionCommand: ResolveChatSessionCommand,
    private readonly loadSessionMessagesCommand: LoadSessionMessagesCommand,
    private readonly introductionCommand: IntroductionCommand,
    private readonly chatThreadTranscriptService: ChatThreadTranscriptService,
    private readonly chatInfoService: IChatInfoService,
    private readonly developerIdentityService: Pick<IDeveloperIdentityService, 'getUserName'>,
    private readonly identityResolver: Pick<AgentRuntimeIdentityResolver, 'resolve'> | undefined,
    private readonly startupTargetResolver: ChatStartupTargetResolver,
    private readonly workspaceRoot: string,
    private readonly systemInfoService: Pick<ISystemInfoService, 'getSystemInfo'>
  ) {}

  async execute(
    payload: ChatStartupParams,
    ctx: ExecutionContext
  ): Promise<CommandResponse<string>> {
    const startupTarget = await this.startupTargetResolver.resolve({
      agentQuery: payload.employeeId,
      sessionId: payload.options.sessionId,
      createNewSession: payload.options.createNewSession,
    });
    if (!startupTarget) {
      return {
        status: 'error',
        message: payload.employeeId
          ? `Unable to resolve chat agent '${payload.employeeId}' or session`
          : 'Unable to resolve a chat agent or resumable session',
      };
    }

    const loadedAgent = startupTarget.agent;
    const agent = this.identityResolver?.resolve(loadedAgent) ?? loadedAgent;

    const developerName = this.developerIdentityService.getUserName() ?? 'Developer';
    const systemInfo = this.systemInfoService.getSystemInfo(this.workspaceRoot);

    this.chatInfoService.showWorkspaceInfo({
      workspace: systemInfo.workspace,
      gitBranch: systemInfo.branch,
    });

    this.chatInfoService.showSessionIntro({
      agent,
      developerName,
    });

    const startup: ChatSessionStartupResult = await runChatSessionStartup(
      {
        agent,
        options: {
          sessionId: startupTarget.sessionId,
          createNewSession: startupTarget.createNewSession,
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

    this.chatInfoService.showActiveSession({
      sessionId: startup.sessionId,
      agentId: agent.id,
    });

    const transcript = await this.chatThreadTranscriptService.load(startup.sessionId);
    this.chatInfoService.showThreadResume(transcript, developerName);

    return { status: 'ok', data: '', message: 'completed' };
  }
}
