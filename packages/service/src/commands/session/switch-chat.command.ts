import type {
  Agent,
  IDeveloperIdentityService,
  IAgentManager,
  ICommand,
  CommandResponse,
  ExecutionContext,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SessionManager } from '../../sessions/session-manager.js';
import { FindAgentSessionCommand } from './find-agent-session.command.js';
export const SwitchChatCommandMetadata = {
  key: 'switch',
  usage: 'switch <agent|role>',
  description: 'Switch to another team member',
  availableIn: { chat: true, tool: false },
  group: 'session',
} satisfies ICommandDescriptor;

export class SwitchChatCommand implements ICommand<string, string> {
  readonly metadata = SwitchChatCommandMetadata;
  private readonly findAgentSession: FindAgentSessionCommand;

  constructor(
    private readonly developerIdentityService: IDeveloperIdentityService,
    private readonly agentManager: Pick<IAgentManager, 'resolveAgentAsync'>,
    private readonly sessionManager: Pick<
      SessionManager,
      'getSession' | 'getOrCreateLatestSession' | 'getSessionMessages'
    >
  ) {
    this.findAgentSession = new FindAgentSessionCommand(sessionManager);
  }

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const query = args.trim();
    if (!query) {
      return { status: 'error', message: 'Usage: /chat <name|role>' };
    }

    const matches = await this.agentManager.resolveAgentAsync(query);
    if (matches.length === 0) {
      return { status: 'error', message: `No agent found matching: "${query}"` };
    }

    const target: Agent = matches.find((a: Agent) => a.id !== ctx.agent?.id) ?? matches[0];
    if (target.id === ctx.agent?.id) {
      return { status: 'ok', message: `Already talking to ${ctx.agent?.name}.` };
    }

    const current = await this.sessionManager.getSession(ctx.sessionId ?? '');
    const developerId =
      (current as any)?.developerId ?? this.developerIdentityService.toDeveloperId('developer');

    const result = await this.findAgentSession.execute({ agentId: target.id, developerId });
    if (result.status !== 'ok' || !result.data) {
      return { status: 'error', message: 'Failed to load session for target agent.' };
    }

    ctx.agent = target;
    ctx.sessionId = result.data.session.id;
    ctx.history = result.data.history;

    const message = `\nSwitched to ${target.name} (${target.role})\n`;
    return { status: 'ok', message, data: target.id };
  }
}
