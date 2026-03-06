import express, { Request, Response } from 'express';
import { resolve, isAbsolute, join } from 'path';
import { watch } from 'fs';
import { createIdeAdapter, IdeAdapter, NoopIdeAdapter } from '@ai-team/ide-interface';
import { ProposalStore } from '@ai-team/service';

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

  async function reconnect(): Promise<void> {
    if (reconnecting) return;
    reconnecting = true;
    try {
      adapter.dispose();
      adapter = await createIdeAdapter(workspaceRoot, 'web');

      // Wire ack handler: delete proposal from store when user clicks Keep/Undo
      adapter.onAck((proposalId, _action) => {
        try { proposalStore.delete(proposalId); } catch { /* best-effort */ }
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

  return router;
}
