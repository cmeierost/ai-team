import type { IChatService, ChatSummary, ChatMessage, MessageStats } from '@ai-team/api-client';
import type { SessionManager } from '../session-manager.js';
import { BadRequestError, NotFoundError } from '../http-errors.js';
import { ChatManager, ChatStorage } from '@ai-team/infrastructure';
import { IAiTeamMediator } from '../../../api-client/dist/contract/routers/streaming.js';

export class ChatService implements IChatService {
  constructor(
    private readonly mediator: IAiTeamMediator,
    private readonly sessionManager: SessionManager,
    private readonly mgr: ChatManager,
    private readonly storage: ChatStorage
  ) {}

  async getSummaries(): Promise<ChatSummary[]> {
    return this.mgr.loadSummaries();
  }

  async getMessages(
    agentId: string,
    query?: { includeArchived?: boolean }
  ): Promise<ChatMessage[]> {
    const session = await this.sessionManager.getLatestSession(agentId);
    if (!session) return [];
    const messages = await this.sessionManager.getSessionMessages(session.id);
    return (
      query?.includeArchived ? messages : messages.filter((m: any) => !m.archived)
    ) as ChatMessage[];
  }

  async post(
    agentId: string,
    body: { content: string; pendingIntroduction?: string }
  ): Promise<{ content: string; handoff?: unknown }> {
    if (!body.content || typeof body.content !== 'string')
      throw new BadRequestError('content is required');
    const stream = this.mediator.streamInteraction({
      command: 'chat',
      payload: {
        employeeId: agentId,
        options: {
          message: body.content,
          oneShot: true,
          ...(body.pendingIntroduction ? { pendingIntroduction: body.pendingIntroduction } : {}),
        },
      },
    });
    let reply = '';
    let handoffEvent: unknown = null;
    for await (const event of stream) {
      if ((event as any).kind === 'token') reply += (event as any).text;
      else if ((event as any).kind === 'handoff') handoffEvent = event;
      else if ((event as any).kind === 'error') throw new Error((event as any).message);
    }
    const resp: Record<string, unknown> = { content: reply.trim() };
    if (handoffEvent) resp.handoff = handoffEvent;
    return resp as { content: string; handoff?: unknown };
  }

  async editMessage(
    agentId: string,
    index: string,
    body: { content: string }
  ): Promise<ChatMessage> {
    const idx = parseInt(index, 10);
    if (isNaN(idx)) throw new BadRequestError('invalid index');
    const updated = await this.mgr.editMessage(agentId, idx, body.content);
    if (updated === undefined || updated === null) throw new NotFoundError('message not found');
    return updated;
  }

  async archiveMessage(agentId: string, index: string): Promise<{ ok: boolean }> {
    const idx = parseInt(index, 10);
    await this.mgr.archiveMessage(agentId, idx);
    return { ok: true };
  }

  async clearHistory(agentId: string): Promise<{ ok: boolean }> {
    await this.storage.clearChatHistory(agentId);
    return { ok: true };
  }

  async getStats(agentId: string): Promise<MessageStats> {
    return this.mgr.getMessageStats(agentId);
  }
}
