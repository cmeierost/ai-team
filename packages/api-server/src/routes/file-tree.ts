import express, { Request, Response } from 'express';
import {
  getFileTreeCommand,
  allowPathCommand,
  disallowPathCommand,
  agentAllowPathCommand,
  agentDisallowPathCommand,
} from '@ai-team/service';

/**
 * @openapi
 * tags:
 *   - name: FileTree
 *     description: Workspace file tree and path permission management
 */
export function createFileTreeRouter(workspaceRoot: string): express.Router {
  const router = express.Router();

  /**
   * @openapi
   * /api/files/tree:
   *   get:
   *     tags: [FileTree]
   *     summary: Get workspace file tree
   *     description: Returns the gitignore-aware workspace file tree. Paths in the allow list are always included.
   *     parameters:
   *       - in: query
   *         name: maxDepth
   *         schema:
   *           type: integer
   *         description: Maximum recursion depth (default 6)
   *       - in: query
   *         name: includeHidden
   *         schema:
   *           type: boolean
   *         description: Include hidden (dot-prefixed) entries
   *       - in: query
   *         name: rootSubPath
   *         schema:
   *           type: string
   *         description: Workspace-relative sub-path to use as tree root
   *     responses:
   *       200:
   *         description: File tree root node
   *       500:
   *         description: Server error
   */
  router.get('/tree', async (req: Request, res: Response) => {
    try {
      const maxDepth = req.query.maxDepth ? Number(req.query.maxDepth) : undefined;
      const includeHidden = req.query.includeHidden === 'true';
      const rootSubPath = req.query.rootSubPath as string | undefined;
      const tree = await getFileTreeCommand(workspaceRoot, { maxDepth, includeHidden, rootSubPath });
      res.json(tree);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @openapi
   * /api/files/allow:
   *   post:
   *     tags: [FileTree]
   *     summary: Add a path to the global gitignore allow list
   *     description: Saves to .ai-team/config.json → fileTree.allowPaths
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [path]
   *             properties:
   *               path:
   *                 type: string
   *     responses:
   *       200:
   *         description: Updated allow list
   *       400:
   *         description: Missing path
   *       500:
   *         description: Server error
   */
  router.post('/allow', async (req: Request, res: Response) => {
    try {
      const { path: filePath } = req.body as { path?: string };
      if (!filePath) return res.status(400).json({ error: '"path" is required' });
      const allowPaths = await allowPathCommand(workspaceRoot, filePath);
      res.json({ allowPaths });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @openapi
   * /api/files/allow:
   *   delete:
   *     tags: [FileTree]
   *     summary: Remove a path from the global gitignore allow list
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [path]
   *             properties:
   *               path:
   *                 type: string
   *     responses:
   *       200:
   *         description: Updated allow list
   *       400:
   *         description: Missing path
   *       500:
   *         description: Server error
   */
  router.delete('/allow', async (req: Request, res: Response) => {
    try {
      const { path: filePath } = req.body as { path?: string };
      if (!filePath) return res.status(400).json({ error: '"path" is required' });
      const allowPaths = await disallowPathCommand(workspaceRoot, filePath);
      res.json({ allowPaths });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @openapi
   * /api/files/agents/{agentId}/allow:
   *   post:
   *     tags: [FileTree]
   *     summary: Add a path to an agent's permission list
   *     description: Updates the agent's .md frontmatter permissions.read or permissions.write
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID or name (partial match supported)
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [path]
   *             properties:
   *               path:
   *                 type: string
   *               mode:
   *                 type: string
   *                 enum: [read, write]
   *                 default: read
   *     responses:
   *       200:
   *         description: Agent with updated permission list
   *       400:
   *         description: Missing path
   *       404:
   *         description: Agent not found
   *       409:
   *         description: Ambiguous agent query
   *       500:
   *         description: Server error
   */
  router.post('/agents/:agentId/allow', async (req: Request, res: Response) => {
    try {
      const { path: filePath, mode } = req.body as { path?: string; mode?: 'read' | 'write' };
      if (!filePath) return res.status(400).json({ error: '"path" is required' });
      const result = await agentAllowPathCommand(workspaceRoot, req.params.agentId, filePath, mode ?? 'read');
      res.json({ agent: result.agent, paths: result.paths, mode: mode ?? 'read' });
    } catch (error) {
      const msg = String(error);
      if (msg.includes('not found')) return res.status(404).json({ error: msg });
      if (msg.includes('Ambiguous')) return res.status(409).json({ error: msg });
      res.status(500).json({ error: msg });
    }
  });

  /**
   * @openapi
   * /api/files/agents/{agentId}/allow:
   *   delete:
   *     tags: [FileTree]
   *     summary: Remove a path from an agent's permission list
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [path]
   *             properties:
   *               path:
   *                 type: string
   *               mode:
   *                 type: string
   *                 enum: [read, write]
   *                 default: read
   *     responses:
   *       200:
   *         description: Agent with updated permission list
   *       400:
   *         description: Missing path
   *       404:
   *         description: Agent not found
   *       409:
   *         description: Ambiguous agent query
   *       500:
   *         description: Server error
   */
  router.delete('/agents/:agentId/allow', async (req: Request, res: Response) => {
    try {
      const { path: filePath, mode } = req.body as { path?: string; mode?: 'read' | 'write' };
      if (!filePath) return res.status(400).json({ error: '"path" is required' });
      const result = await agentDisallowPathCommand(workspaceRoot, req.params.agentId, filePath, mode ?? 'read');
      res.json({ agent: result.agent, paths: result.paths, mode: mode ?? 'read' });
    } catch (error) {
      const msg = String(error);
      if (msg.includes('not found')) return res.status(404).json({ error: msg });
      if (msg.includes('Ambiguous')) return res.status(409).json({ error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
