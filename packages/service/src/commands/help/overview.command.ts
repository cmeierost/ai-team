import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { SessionManager } from '../../session-manager.js';
import type { ChatCommandEmitter } from '../../orchestrator/services/emit-service.js';
export const OverviewChatCommandMetadata = {
  key: 'overview',
  description: 'Workspace file overview → shared with agent',
  availableIn: { chat: true, tool: false },
  group: 'chat',
} satisfies ICommandDescriptor;

export class OverviewChatCommand implements ICommand<string, void> {
  readonly metadata = OverviewChatCommandMetadata;

  constructor(
    private readonly sessionManager: Pick<SessionManager, 'appendMessage'>,
    private readonly emitter: ChatCommandEmitter
  ) {}

  async execute(_args: string, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const { getWorkspaceOverview } = await import('../../utils/workspace.js');
    const overview = await getWorkspaceOverview(ctx.workspaceRoot);
    this.emitter.write('\n── Workspace Overview ──────────────────────────────────────\n');
    this.emitter.write(overview);
    const sysMsg = {
      timestamp: new Date().toISOString(),
      from: 'system' as const,
      content: `Tool Output (overview):\n${overview.slice(0, 4_000)}`,
    };
    await this.sessionManager.appendMessage(ctx.sessionId!, sysMsg);
    ctx.history.push(sysMsg);
    this.emitter.write(`\n(Overview shared with ${ctx.agent?.name}.)\n`);
    return { status: 'ok' };
  }
}
