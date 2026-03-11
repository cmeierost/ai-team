import express, { Request, Response } from 'express';
import { AgentManager, loadAgentAccessPatterns, loadTeamConfig } from '@ai-team/core';
import {
  getFileTreeCommand,
  allowPathCommand,
  disallowPathCommand,
  agentAllowPathCommand,
  agentDisallowPathCommand,
} from '@ai-team/service';

type PathMode = 'read' | 'write' | 'create' | 'delete';
type PathMutationBody = { path?: string; mode?: PathMode };

/**
 * @openapi
 * tags:
 *   - name: FileTree
 *     description: Workspace file tree and path permission management
 */
export function createFileTreeRouter(workspaceRoot: string): express.Router {
  const router = express.Router();

  router.get('/patterns', async (req: Request, res: Response) => {
    try {
      const config = await loadTeamConfig(workspaceRoot);
      const allowPaths = Array.from(new Set([
        ...(config?.fileTree?.readPaths ?? []),
        ...(config?.fileTree?.writePaths ?? []),
        ...(config?.fileTree?.createPaths ?? []),
        ...(config?.fileTree?.deletePaths ?? []),
      ]));
      const globalPatterns = {
        allowPaths,
        readPaths: config?.fileTree?.readPaths ?? [],
        writePaths: config?.fileTree?.writePaths ?? [],
        createPaths: config?.fileTree?.createPaths ?? [],
        deletePaths: config?.fileTree?.deletePaths ?? [],
      };

      const agentQuery = typeof req.query.agent === 'string' ? req.query.agent : undefined;
      if (!agentQuery) {
        return res.json({ global: globalPatterns });
      }

      const manager = new AgentManager(workspaceRoot);
      await manager.initialize();
      const matches = manager.resolveAgent(agentQuery);
      if (matches.length === 0) {
        return res.status(404).json({ error: `Agent not found: "${agentQuery}"` });
      }
      if (matches.length > 1) {
        return res.status(409).json({
          error: `Ambiguous agent "${agentQuery}"`,
          matches: matches.map((a) => a.id),
        });
      }

      const agent = matches[0];
      const accessPatterns = await loadAgentAccessPatterns(workspaceRoot, agent.id);

      return res.json({
        global: globalPatterns,
        agent: {
          id: agent.id,
          readPaths: accessPatterns.read,
          writePaths: accessPatterns.write,
          createPaths: accessPatterns.create,
          deletePaths: accessPatterns.delete,
        },
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

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
      const message = String(error);
      if (message.includes('outside workspace root')) {
        return res.status(400).json({ error: message });
      }
      res.status(500).json({ error: message });
    }
  });

  /**
   * @openapi
   * /api/files/allow:
   *   post:
   *     tags: [FileTree]
   *     summary: Add a path to global file visibility/permission patterns
   *     description: |
  *       - mode omitted: updates .ai-team/config.json → fileTree.readPaths
   *       - mode=read: updates .ai-team/config.json → fileTree.readPaths
   *       - mode=write: updates .ai-team/config.json → fileTree.writePaths
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
  *                 description: Optional. Defaults to read.
   *     responses:
   *       200:
   *         description: Updated path list for selected mode
   *       400:
   *         description: Missing path or invalid mode
   *       500:
   *         description: Server error
   */
  router.post('/allow', async (req: Request, res: Response) => {
    try {
      const { path: filePath, mode } = req.body as PathMutationBody;
      if (!filePath) return res.status(400).json({ error: '"path" is required' });
      if (mode && mode !== 'read' && mode !== 'write' && mode !== 'create' && mode !== 'delete') {
        return res.status(400).json({ error: '"mode" must be one of "read", "write", "create", "delete" when provided' });
      }
      const resolvedMode = mode ?? 'read';
      const paths = await allowPathCommand(workspaceRoot, filePath, resolvedMode);
      res.json({ mode: resolvedMode, paths });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  /**
   * @openapi
   * /api/files/allow:
   *   delete:
   *     tags: [FileTree]
   *     summary: Remove a path from global file visibility/permission patterns
   *     description: |
  *       - mode omitted: updates .ai-team/config.json → fileTree.readPaths
   *       - mode=read: updates .ai-team/config.json → fileTree.readPaths
   *       - mode=write: updates .ai-team/config.json → fileTree.writePaths
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
  *                 description: Optional. Defaults to read.
   *     responses:
   *       200:
   *         description: Updated path list for selected mode
   *       400:
   *         description: Missing path or invalid mode
   *       500:
   *         description: Server error
   */
  router.delete('/allow', async (req: Request, res: Response) => {
    try {
      const { path: filePath, mode } = req.body as PathMutationBody;
      if (!filePath) return res.status(400).json({ error: '"path" is required' });
      if (mode && mode !== 'read' && mode !== 'write' && mode !== 'create' && mode !== 'delete') {
        return res.status(400).json({ error: '"mode" must be one of "read", "write", "create", "delete" when provided' });
      }
      const resolvedMode = mode ?? 'read';
      const paths = await disallowPathCommand(workspaceRoot, filePath, resolvedMode);
      res.json({ mode: resolvedMode, paths });
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
      const { path: filePath, mode } = req.body as PathMutationBody;
      if (!filePath) return res.status(400).json({ error: '"path" is required' });
      const resolvedMode = mode ?? 'read';
      if (resolvedMode !== 'read' && resolvedMode !== 'write' && resolvedMode !== 'create' && resolvedMode !== 'delete') {
        return res.status(400).json({ error: '"mode" must be one of "read", "write", "create", "delete" when provided' });
      }
      const result = await agentAllowPathCommand(workspaceRoot, req.params.agentId, filePath, resolvedMode);
      res.json({ agent: result.agent, paths: result.paths, mode: resolvedMode });
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
      const { path: filePath, mode } = req.body as PathMutationBody;
      if (!filePath) return res.status(400).json({ error: '"path" is required' });
      const resolvedMode = mode ?? 'read';
      if (resolvedMode !== 'read' && resolvedMode !== 'write' && resolvedMode !== 'create' && resolvedMode !== 'delete') {
        return res.status(400).json({ error: '"mode" must be one of "read", "write", "create", "delete" when provided' });
      }
      const result = await agentDisallowPathCommand(workspaceRoot, req.params.agentId, filePath, resolvedMode);
      res.json({ agent: result.agent, paths: result.paths, mode: resolvedMode });
    } catch (error) {
      const msg = String(error);
      if (msg.includes('not found')) return res.status(404).json({ error: msg });
      if (msg.includes('Ambiguous')) return res.status(409).json({ error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
