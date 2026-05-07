import { z } from 'zod';
import type { IContextService } from '@ai-team/api-contracts';
import type {
  ICommand,
  CommandRuntime,
  IAgentManager,
  ISkillManager,
  IMarkdownSectionService,
  IConfigurationStorage,
  IEnvironmentStorage,
  IAgentDocumentStorage,
  IPathPermissionChecker,
  ILlmService,
  IProposalStoreFactory,
} from '@ai-team/core';
import type { SessionManager } from '../../session-manager.js';
import { ChatCommand, type ChatRuntimeHooks } from './index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = z.infer<typeof ChatICommand.schema>;

export class ChatICommand implements ICommand<Params, void, void> {
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
  readonly parameters = ChatICommand.schema;

  constructor(
    private readonly configStorage: IConfigurationStorage,
    private readonly envStorage: IEnvironmentStorage,
    private readonly agentDocStorage: IAgentDocumentStorage,
    private readonly agentManager: IAgentManager,
    private readonly llmService: ILlmService,
    private readonly skillManager: ISkillManager,
    private readonly markdownSectionService: IMarkdownSectionService,
    private readonly pathPermissionChecker: IPathPermissionChecker,
    private readonly proposalStoreFactory: IProposalStoreFactory,
    private readonly contextService: Pick<IContextService, 'getContextEstimate'>,
    private readonly sessionManager?: SessionManager,
  ) {}

  async execute(payload: Params, _ctx: void, runtime: CommandRuntime): Promise<void> {
    const hooks: ChatRuntimeHooks = {
      signal: runtime.signal,
      emit: runtime.emit as ChatRuntimeHooks['emit'],
      questionInput: runtime.questionInput,
      questionConfirm: runtime.questionConfirm,
      questionSelect: runtime.questionSelect,
      questionPassword: runtime.questionPassword,
      questionChecklist: runtime.questionChecklist,
      workflowState: runtime.workflowState as ChatRuntimeHooks['workflowState'],
      onWorkflowFrame: runtime.onWorkflowFrame as ChatRuntimeHooks['onWorkflowFrame'],
    };

    const cmd = new ChatCommand(
      this.configStorage,
      this.envStorage,
      this.agentDocStorage,
      this.agentManager,
      this.llmService,
      this.skillManager,
      this.markdownSectionService,
      this.pathPermissionChecker,
      this.proposalStoreFactory,
      this.contextService,
      this.sessionManager
    );

    await cmd.execute(runtime.workspaceRoot, payload.employeeId, payload.options ?? {}, hooks);
  }
}
