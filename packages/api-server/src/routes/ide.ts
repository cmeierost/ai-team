import express, { Request, Response } from 'express';
import { resolve, isAbsolute, join } from 'node:path';
import { watch } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createIdeAdapter, IdeAdapter, NoopIdeAdapter } from '@ai-team/ide-interface';
import { ProposalStore } from '@ai-team/service';

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
  lastOrigin?: 'vscode' | 'ai-team';
  lastSeq?: number;
}

interface CompletedEditSession {
  sessionId: string;
  operationId: string;
  traceId?: string;
  state: 'closed';
  terminalState?: 'committed' | 'reverted';
  closedBy: 'ack-accept' | 'ack-reject' | 'reset';
  filePath: string;
  lastOrigin?: 'vscode' | 'ai-team';
  lastSeq?: number;
  createdAt: string;
  lastUpdatedAt: string;
  additions: number;
  deletions: number;
}

function lineCount(value: string): number {
  if (!value) return 0;
  return value.split('\n').length;
}

function summarizeDelta(before: string, after: string): { additions: number; deletions: number } {
  const beforeLines = lineCount(before);
  const afterLines = lineCount(after);
  if (afterLines >= beforeLines) {
    return { additions: afterLines - beforeLines, deletions: 0 };
  }
  return { additions: 0, deletions: beforeLines - afterLines };
}

/**
 * @openapi
 * tags:
 *   - name: IDE
 *     description: IDE integration endpoints
 */
export function createIdeRouter(workspaceRoot: string): express.Router {
  const router = express.Router();

  // Persistent adapter — stays connected so the IDE shows it in the connections view.
  // Reconnects automatically whenever .ide-server.json changes (e.g. VS Code restarts).
  let adapter: IdeAdapter = new NoopIdeAdapter();
  let reconnecting = false;
  const proposalStore = new ProposalStore(workspaceRoot);
  const editSessions = new Map<string, EditSession>();
  const completedEditSessions = new Map<string, CompletedEditSession>();

  async function pushSessionProposal(session: EditSession, note: string): Promise<void> {
    const a = await getAdapter();
    const delta = summarizeDelta(session.originalContent, session.currentContent);
    await a.notifyCodeEditProposal({
      proposalId: session.sessionId,
      agentName: session.agentName,
      description: `${session.description} (${note})`,
      files: [
        {
          filePath: session.filePath,
          oldContent: session.originalContent,
          newContent: session.currentContent,
          additions: delta.additions,
          deletions: delta.deletions,
        },
      ],
    });
  }

  async function commitSession(session: EditSession): Promise<{ finalContent: string; terminalState: 'committed' }> {
    session.state = 'committed';
    session.lastUpdatedAt = new Date().toISOString();
    return {
      finalContent: session.currentContent,
      terminalState: 'committed',
    };
  }

  async function revertSession(session: EditSession): Promise<{ terminalState: 'reverted' }> {
    session.currentContent = session.originalContent;
    session.state = 'reverted';
    session.lastUpdatedAt = new Date().toISOString();
    await pushSessionProposal(session, 'revert');
    return {
      terminalState: 'reverted',
    };
  }

  function closeSession(
    session: EditSession,
    options: {
      terminalState?: 'committed' | 'reverted';
      closedBy: 'ack-accept' | 'ack-reject' | 'reset';
    },
  ): void {
    completedEditSessions.set(session.sessionId, {
      sessionId: session.sessionId,
      operationId: session.operationId,
      traceId: session.traceId,
      state: 'closed',
      terminalState: options.terminalState,
      closedBy: options.closedBy,
      filePath: session.filePath,
      lastOrigin: session.lastOrigin,
      lastSeq: session.lastSeq,
      createdAt: session.createdAt,
      lastUpdatedAt: new Date().toISOString(),
      additions: summarizeDelta(session.originalContent, session.currentContent).additions,
      deletions: summarizeDelta(session.originalContent, session.currentContent).deletions,
    });

    session.state = 'closed';
    session.lastUpdatedAt = new Date().toISOString();
    editSessions.delete(session.sessionId);
  }

  async function finalizeSessionFromAck(
    proposalId: string,
    action: 'accept' | 'reject',
  ): Promise<void> {
    const session = editSessions.get(proposalId);
    if (!session) {
      return;
    }

    if (action === 'accept') {
      if (session.state !== 'reverted' && session.state !== 'closed') {
        const result = await commitSession(session);
        closeSession(session, { terminalState: result.terminalState, closedBy: 'ack-accept' });
        return;
      }
      closeSession(session, { closedBy: 'ack-accept' });
      return;
    }

    if (session.state !== 'committed' && session.state !== 'closed') {
      const result = await revertSession(session);
      closeSession(session, { terminalState: result.terminalState, closedBy: 'ack-reject' });
      return;
    }
    closeSession(session, { closedBy: 'ack-reject' });
  }

  function getSessionOr400(req: Request, res: Response): EditSession | undefined {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return undefined;
    }
    const session = editSessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: `Unknown sessionId: ${sessionId}` });
      return undefined;
    }
    return session;
  }

  async function reconnect(): Promise<void> {
    if (reconnecting) return;
    reconnecting = true;
    try {
      adapter.dispose();
      adapter = await createIdeAdapter(workspaceRoot, 'web');

      // Wire ack handler: finalize lifecycle session + clear pending proposal store
      adapter.onAck((proposalId, action) => {
        void finalizeSessionFromAck(proposalId, action)
          .catch(() => { /* best-effort */ })
          .finally(() => {
            try { proposalStore.delete(proposalId); } catch { /* best-effort */ }
          });
      });

      // Replay any pending proposals (VS Code may have been closed when they arrived)
      const pending = proposalStore.loadAll();
      for (const p of pending) {
        adapter.notifyCodeEditProposal({
          proposalId: p.proposalId,
          agentName: p.agentName,
          description: p.description,
          files: p.files.map(f => ({
            filePath: f.filePath,
            oldContent: f.oldContent,
            newContent: f.newContent,
            additions: f.additions ?? 0,
            deletions: f.deletions ?? 0,
          })),
        }).catch(() => { /* best-effort */ });
      }
    } finally {
      reconnecting = false;
    }
  }

  async function getAdapter(): Promise<IdeAdapter> {
    if (!adapter.isConnected()) await reconnect();
    return adapter;
  }

  // Watch the .ai-team dir so we reconnect when VS Code rewrites .ide-server.json
  // (catches both file creation and updates, e.g. after a VS Code restart/reload)
  const aiTeamDir = join(workspaceRoot, '.ai-team');
  try {
    watch(aiTeamDir, { persistent: false }, (_event, filename) => {
      if (filename === '.ide-server.json') {
        setTimeout(() => reconnect().catch(() => {}), 600);
      }
    });
  } catch {
    // .ai-team dir may not exist; lazily reconnects on first request
  }

  // Eagerly connect on startup
  reconnect().catch(() => { /* no plugin running yet — ok */ });

  /**
   * @openapi
   * /api/ide/open-file:
   *   post:
   *     tags: [IDE]
   *     summary: Open a file in the connected IDE
   *     description: Sends an open-file request to the VS Code plugin (or other IDE) connected to this workspace. No-op if no IDE is connected.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [filePath]
   *             properties:
   *               filePath:
   *                 type: string
   *                 description: Absolute or workspace-relative path to open
   *               line:
   *                 type: integer
   *                 description: Optional 1-based line number to jump to
   *     responses:
   *       200:
   *         description: Request sent (or no IDE connected)
   *       400:
   *         description: Missing filePath
   */
  router.post('/open-file', async (req: Request, res: Response) => {
    const { filePath, line } = req.body as { filePath?: string; line?: number };

    if (!filePath) {
      res.status(400).json({ error: 'filePath is required' });
      return;
    }

    try {
      // Resolve workspace-relative paths to absolute
      const absolutePath = isAbsolute(filePath) ? filePath : resolve(workspaceRoot, filePath);
      const a = await getAdapter();
      await a.openFile(absolutePath, line);
      res.json({ ok: true, ideConnected: a.isConnected() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  /**
   * @openapi
   * /api/ide/status:
   *   get:
   *     tags: [IDE]
   *     summary: Get IDE connection status
   *     responses:
   *       200:
   *         description: Current IDE connection state
   */
  router.get('/status', (_req: Request, res: Response) => {
    res.json({ ideConnected: adapter.isConnected() });
  });

  /**
   * @openapi
   * /api/ide/v1/edit/open-diff:
   *   post:
   *     tags: [IDE]
   *     summary: Open an edit session for one file
   */
  router.post('/v1/edit/open-diff', async (req: Request, res: Response) => {
    const {
      operationId,
      traceId,
      filePath,
      originalContent = '',
      editType,
      agentName = 'AI Team',
      description = 'Code edit proposal',
    } = req.body as {
      operationId?: string;
      traceId?: string;
      filePath?: string;
      originalContent?: string;
      editType?: 'modify' | 'create';
      agentName?: string;
      description?: string;
    };

    if (!operationId) {
      res.status(400).json({ error: 'operationId is required' });
      return;
    }
    if (!filePath) {
      res.status(400).json({ error: 'filePath is required' });
      return;
    }

    const absolutePath = isAbsolute(filePath) ? filePath : resolve(workspaceRoot, filePath);
    const a = await getAdapter();
    await a.openFile(absolutePath);

    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const session: EditSession = {
      sessionId,
      operationId,
      traceId,
      filePath: absolutePath,
      originalContent,
      currentContent: originalContent,
      state: editType === 'create' ? 'ready' : 'open',
      agentName,
      description,
      createdAt: now,
      lastUpdatedAt: now,
    };
    editSessions.set(sessionId, session);

    res.json({
      ok: true,
      sessionId,
      operationId,
      state: session.state,
      ideConnected: a.isConnected(),
    });
  });

  /**
   * @openapi
   * /api/ide/v1/edit/update:
   *   post:
   *     tags: [IDE]
   *     summary: Update an edit session with latest content
   */
  router.post('/v1/edit/update', async (req: Request, res: Response) => {
    const session = getSessionOr400(req, res);
    if (!session) return;

    const { content, isFinal = false } = req.body as { content?: string; isFinal?: boolean };
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content is required and must be a string' });
      return;
    }
    if (session.state === 'committed' || session.state === 'reverted' || session.state === 'closed') {
      res.status(409).json({ error: `Session is already terminal (${session.state})` });
      return;
    }

    session.currentContent = content;
    session.state = isFinal ? 'ready' : 'streaming';
    session.lastUpdatedAt = new Date().toISOString();

    await pushSessionProposal(session, isFinal ? 'final update' : 'stream update');

    res.json({
      ok: true,
      sessionId: session.sessionId,
      state: session.state,
      additions: summarizeDelta(session.originalContent, session.currentContent).additions,
      deletions: summarizeDelta(session.originalContent, session.currentContent).deletions,
    });
  });

  /**
   * @openapi
   * /api/ide/v1/edit/commit:
   *   post:
   *     tags: [IDE]
   *     summary: Commit (keep) current edit session content
   */
  router.post('/v1/edit/commit', async (req: Request, res: Response) => {
    const session = getSessionOr400(req, res);
    if (!session) return;

    if (session.state === 'reverted' || session.state === 'closed') {
      res.status(409).json({ error: `Cannot commit session in state ${session.state}` });
      return;
    }

    const result = await commitSession(session);

    res.json({
      ok: true,
      sessionId: session.sessionId,
      state: session.state,
      finalContent: result.finalContent,
      terminalState: result.terminalState,
    });
  });

  router.post('/v1/edit/keep', async (req: Request, res: Response) => {
    const { origin = 'ai-team', seq } = req.body as { origin?: 'vscode' | 'ai-team'; seq?: number };
    const session = getSessionOr400(req, res);
    if (!session) return;
    if (typeof seq === 'number') session.lastSeq = seq;
    session.lastOrigin = origin;

    if (session.state === 'reverted' || session.state === 'closed') {
      res.status(409).json({ error: `Cannot commit session in state ${session.state}` });
      return;
    }

    const result = await commitSession(session);
    res.json({
      ok: true,
      sessionId: session.sessionId,
      state: session.state,
      finalContent: result.finalContent,
      terminalState: result.terminalState,
    });
  });

  /**
   * @openapi
   * /api/ide/v1/edit/revert:
   *   post:
   *     tags: [IDE]
   *     summary: Revert (undo) current edit session content
   */
  router.post('/v1/edit/revert', async (req: Request, res: Response) => {
    const session = getSessionOr400(req, res);
    if (!session) return;

    if (session.state === 'committed' || session.state === 'closed') {
      res.status(409).json({ error: `Cannot revert session in state ${session.state}` });
      return;
    }

    const result = await revertSession(session);

    res.json({
      ok: true,
      sessionId: session.sessionId,
      state: session.state,
      terminalState: result.terminalState,
    });
  });

  router.post('/v1/edit/undo', async (req: Request, res: Response) => {
    const { origin = 'ai-team', seq } = req.body as { origin?: 'vscode' | 'ai-team'; seq?: number };
    const session = getSessionOr400(req, res);
    if (!session) return;
    if (typeof seq === 'number') session.lastSeq = seq;
    session.lastOrigin = origin;

    if (session.state === 'committed' || session.state === 'closed') {
      res.status(409).json({ error: `Cannot revert session in state ${session.state}` });
      return;
    }

    const result = await revertSession(session);
    res.json({
      ok: true,
      sessionId: session.sessionId,
      state: session.state,
      terminalState: result.terminalState,
    });
  });

  /**
   * @openapi
   * /api/ide/v1/edit/reset:
   *   post:
   *     tags: [IDE]
   *     summary: Close and cleanup an edit session
   */
  router.post('/v1/edit/reset', (req: Request, res: Response) => {
    const session = getSessionOr400(req, res);
    if (!session) return;

    closeSession(session, { closedBy: 'reset' });

    res.json({ ok: true, sessionId: session.sessionId, state: 'closed' as const });
  });

  /**
   * @openapi
   * /api/ide/v1/edit/status:
   *   get:
   *     tags: [IDE]
   *     summary: Get current edit session state
   */
  router.get('/v1/edit/status', (req: Request, res: Response) => {
    const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : undefined;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId query parameter is required' });
      return;
    }

    const session = editSessions.get(sessionId);
    if (!session) {
      const completed = completedEditSessions.get(sessionId);
      if (!completed) {
        res.status(404).json({ error: `Unknown sessionId: ${sessionId}` });
        return;
      }

      res.json(completed);
      return;
    }

    res.json({
      sessionId: session.sessionId,
      operationId: session.operationId,
      traceId: session.traceId,
      state: session.state,
      filePath: session.filePath,
      lastOrigin: session.lastOrigin,
      lastSeq: session.lastSeq,
      createdAt: session.createdAt,
      lastUpdatedAt: session.lastUpdatedAt,
      additions: summarizeDelta(session.originalContent, session.currentContent).additions,
      deletions: summarizeDelta(session.originalContent, session.currentContent).deletions,
    });
  });

  return router;
}
