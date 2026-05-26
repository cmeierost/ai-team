import type { IIdeService } from '@ai-team/api-contracts';
import type { IdeAdapter, IIdeAdapterFactory } from '@ai-team/core';
import { join, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { BadRequestError, ConflictError, NotFoundError } from '@ai-team/core';

// ─── Edit session types ───────────────────────────────────────────────────────

type EditSessionState = 'open' | 'streaming' | 'ready' | 'committed' | 'reverted' | 'closed';

interface EditSession {
  sessionId: string;
  operationId: string;
  traceId?: string;
  filePath: string;
  originalContent: string;
  currentContent: string;
  state: EditSessionState;
  agentName: string;
  description: string;
  createdAt: string;
  lastUpdatedAt: string;
}

// ─── IdeService ───────────────────────────────────────────────────────────────

export class IdeService implements IIdeService {
  private adapter: IdeAdapter = {
    lsp: {
      execute: async () => ({ kind: 'locations' as const, locations: [] }),
      isAvailable: () => false,
    },
    openFile: async () => {},
    notifyCodeEditProposal: async () => {},
    isConnected: () => false,
    onAck: () => {},
    dispose: () => {},
  };
  private reconnecting = false;
  private readonly editSessions = new Map<string, EditSession>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly ideAdapterFactory: IIdeAdapterFactory
  ) {
    const aiTeamDir = join(workspaceRoot, '.ai-team');
    try {
      watch(aiTeamDir, { persistent: false }, (_e, filename) => {
        if (filename === '.ide-server.json')
          setTimeout(() => this.reconnect().catch(() => {}), 600);
      });
    } catch {
      /* dir may not exist */
    }
    this.reconnect().catch(() => {});
  }

  private async reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      if ('dispose' in this.adapter) (this.adapter as any).dispose();
      this.adapter = await this.ideAdapterFactory.createAsync(this.workspaceRoot, 'web');
    } finally {
      this.reconnecting = false;
    }
  }

  private async getAdapter() {
    if (!this.adapter.isConnected()) await this.reconnect();
    return this.adapter;
  }

  private async pushProposal(session: EditSession, note: string) {
    const a = await this.getAdapter();
    const before = session.originalContent.split('\n').length;
    const after = session.currentContent.split('\n').length;
    const additions = Math.max(0, after - before);
    const deletions = Math.max(0, before - after);
    await a.notifyCodeEditProposal({
      proposalId: session.sessionId,
      agentName: session.agentName,
      description: `${session.description} (${note})`,
      files: [
        {
          filePath: session.filePath,
          oldContent: session.originalContent,
          newContent: session.currentContent,
          additions,
          deletions,
        },
      ],
    });
  }

  async openFile(body: { filePath: string; line?: number }) {
    if (!body.filePath) throw new BadRequestError('filePath is required');
    const absolutePath = isAbsolute(body.filePath)
      ? body.filePath
      : resolve(this.workspaceRoot, body.filePath);
    const a = await this.getAdapter();
    await a.openFile(absolutePath, body.line);
    return { ok: true, ideConnected: a.isConnected() };
  }

  async getStatus() {
    const a = await this.getAdapter();
    return { ideConnected: a.isConnected() };
  }

  async openDiff(body: {
    operationId: string;
    traceId?: string;
    filePath: string;
    newContent?: string;
    agentName: string;
    description: string;
  }) {
    if (!body.operationId || !body.filePath)
      throw new BadRequestError('operationId and filePath are required');
    const existing = Array.from(this.editSessions.values()).find(
      (s) => s.operationId === body.operationId
    );
    if (existing)
      throw new ConflictError(`Edit session already exists for operationId ${body.operationId}`);
    const { readFileSync, existsSync } = await import('fs');
    const absPath = isAbsolute(body.filePath)
      ? body.filePath
      : resolve(this.workspaceRoot, body.filePath);
    const originalContent = existsSync(absPath) ? readFileSync(absPath, 'utf8') : '';
    const sessionId = randomUUID();
    const session: EditSession = {
      sessionId,
      operationId: body.operationId,
      traceId: body.traceId,
      filePath: absPath,
      originalContent,
      currentContent: body.newContent ?? originalContent,
      state: 'open',
      agentName: body.agentName ?? 'AI',
      description: body.description ?? '',
      createdAt: new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
    this.editSessions.set(sessionId, session);
    await this.pushProposal(session, 'open');
    return { sessionId, state: session.state };
  }

  async updateEdit(body: { sessionId: string; newContent: string }) {
    if (!body.sessionId) throw new BadRequestError('sessionId is required');
    const session = this.editSessions.get(body.sessionId);
    if (!session) throw new NotFoundError(`Unknown sessionId: ${body.sessionId}`);
    session.currentContent = body.newContent;
    session.state = 'ready';
    session.lastUpdatedAt = new Date().toISOString();
    await this.pushProposal(session, 'update');
    return { sessionId: session.sessionId, state: session.state };
  }

  async commitEdit(body: { sessionId: string }) {
    if (!body.sessionId) throw new BadRequestError('sessionId is required');
    const session = this.editSessions.get(body.sessionId);
    if (!session) throw new NotFoundError(`Unknown sessionId: ${body.sessionId}`);
    session.state = 'committed';
    session.lastUpdatedAt = new Date().toISOString();
    return {
      sessionId: session.sessionId,
      finalContent: session.currentContent,
      terminalState: 'committed',
    };
  }

  async keepEdit(body: { sessionId: string }) {
    if (!body.sessionId) throw new BadRequestError('sessionId is required');
    const session = this.editSessions.get(body.sessionId);
    if (!session) throw new NotFoundError(`Unknown sessionId: ${body.sessionId}`);
    session.state = 'committed';
    session.lastUpdatedAt = new Date().toISOString();
    this.editSessions.delete(session.sessionId);
    return {
      sessionId: session.sessionId,
      state: 'closed',
      finalContent: session.currentContent,
      terminalState: 'committed',
    };
  }

  async revertEdit(body: { sessionId: string }) {
    if (!body.sessionId) throw new BadRequestError('sessionId is required');
    const session = this.editSessions.get(body.sessionId);
    if (!session) throw new NotFoundError(`Unknown sessionId: ${body.sessionId}`);
    session.currentContent = session.originalContent;
    session.state = 'reverted';
    session.lastUpdatedAt = new Date().toISOString();
    await this.pushProposal(session, 'revert');
    return { sessionId: session.sessionId, state: session.state, terminalState: 'reverted' };
  }

  async undoEdit(body: { sessionId: string }) {
    if (!body.sessionId) throw new BadRequestError('sessionId is required');
    const session = this.editSessions.get(body.sessionId);
    if (!session) throw new NotFoundError(`Unknown sessionId: ${body.sessionId}`);
    session.state = 'open';
    session.lastUpdatedAt = new Date().toISOString();
    return { sessionId: session.sessionId, state: session.state };
  }

  async resetEdit(body: { sessionId: string }) {
    if (!body.sessionId) throw new BadRequestError('sessionId is required');
    const session = this.editSessions.get(body.sessionId);
    if (!session) throw new NotFoundError(`Unknown sessionId: ${body.sessionId}`);
    this.editSessions.delete(body.sessionId);
    return { sessionId: session.sessionId, state: 'closed' };
  }

  async getEditStatus(query?: { sessionId?: string; operationId?: string }) {
    if (query?.sessionId) {
      const s = this.editSessions.get(query.sessionId);
      if (!s) throw new NotFoundError(`Unknown sessionId: ${query.sessionId}`);
      return s;
    }
    if (query?.operationId) {
      const s = Array.from(this.editSessions.values()).find(
        (x) => x.operationId === query.operationId
      );
      if (!s) throw new NotFoundError(`Unknown operationId: ${query.operationId}`);
      return s;
    }
    return { active: Array.from(this.editSessions.values()) };
  }
}
