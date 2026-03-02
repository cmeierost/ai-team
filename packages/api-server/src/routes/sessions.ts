import { Router } from 'express';
import { SessionManager, createSqliteStorage } from '@ai-team/service';
import type { AgentManager } from '@ai-team/core';
import express from 'express';

export function createSessionsRouter(workspaceRoot: string, agentManager?: AgentManager): Router {
  const router = express.Router();
  const storage = createSqliteStorage(workspaceRoot);
  const sessionManager = new SessionManager(workspaceRoot, storage, agentManager);

  // Initialize session manager
  sessionManager.initialize().catch((error) => {
    console.error('Failed to initialize session manager:', error);
  });

  /**
   * @openapi
   * /api/sessions/{agentId}/latest:
   *   get:
   *     tags: [Sessions]
   *     summary: Get latest session for an agent
   *     description: Returns the most recent chat session for the specified agent
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: query
   *         name: includeMessages
   *         schema:
   *           type: boolean
   *           default: false
   *         description: Include messages in the response
   *     responses:
   *       200:
   *         description: Latest session data
   *       404:
   *         description: No session found for agent
   */
  router.get('/:agentId/latest', async (req: any, res: any, next: any) => {
    try {
      const { agentId } = req.params;
      const includeMessages = req.query.includeMessages === 'true';
      const session = await sessionManager.getLatestSession(agentId);
      
      if (!session) {
        return res.status(404).json({
          error: 'No session found',
          details: `No sessions exist for agent ${agentId}`,
        });
      }

      if (includeMessages) {
        const messages = await sessionManager.getSessionMessages(session.id);
        res.json({ ...session, messages });
      } else {
        res.json(session);
      }
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/recent:
   *   get:
   *     tags: [Sessions]
   *     summary: Get recent sessions across all agents
   *     description: Returns recent chat sessions sorted by last activity, useful for dashboard
   *     parameters:
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 10
   *         description: Maximum number of sessions to return
   *     responses:
   *       200:
   *         description: Array of recent sessions
   */
  router.get('/recent', async (req: any, res: any, next: any) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : 10;
      const sessions = await storage.listSessions({
        sortBy: 'lastActivityAt',
        sortOrder: 'desc',
        limit,
      });

      res.json(sessions);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions:
   *   get:
   *     tags: [Sessions]
   *     summary: List sessions for an agent
   *     description: Returns all chat sessions for the specified agent
   *     parameters:
   *       - in: query
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *         description: Maximum number of sessions to return
   *     responses:
   *       200:
   *         description: Array of sessions
   *       400:
   *         description: Missing agentId parameter
   */
  router.get('/', async (req: any, res: any, next: any) => {
    try {
      const { agentId, limit } = req.query;

      if (!agentId) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'agentId query parameter is required',
        });
      }

      const limitNum = limit ? parseInt(limit, 10) : undefined;
      const sessions = await sessionManager.listSessions(agentId, limitNum);

      res.json(sessions);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/{sessionId}:
   *   get:
   *     tags: [Sessions]
   *     summary: Get session by ID
   *     description: Returns detailed information about a specific session
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID (UUID)
   *       - in: query
   *         name: includeMessages
   *         schema:
   *           type: boolean
   *           default: false
   *         description: Include messages in the response
   *     responses:
   *       200:
   *         description: Session data
   *       404:
   *         description: Session not found
   */
  router.get('/:sessionId', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;
      const includeMessages = req.query.includeMessages === 'true';
      const session = await sessionManager.getSession(sessionId);

      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          details: `Session ${sessionId} does not exist`,
        });
      }

      if (includeMessages) {
        const messages = await sessionManager.getSessionMessages(sessionId);
        res.json({ ...session, messages });
      } else {
        res.json(session);
      }
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/{sessionId}/messages:
   *   get:
   *     tags: [Sessions]
   *     summary: Get messages for a session
   *     description: Returns all messages in  a specific session
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID (UUID)
   *     responses:
   *       200:
   *         description: Array of messages
   */
  router.get('/:sessionId/messages', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;
      const messages = await sessionManager.getSessionMessages(sessionId);
      res.json(messages);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions:
   *   post:
   *     tags: [Sessions]
   *     summary: Create a new session
   *     description: Create a new chat session for an agent
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - agentId
   *               - developerId
   *             properties:
   *               agentId:
   *                 type: string
   *                 description: Agent ID
   *               developerId:
   *                 type: string
   *                 description: Developer/user ID
   *     responses:
   *       200:
   *         description: Created session
   *       400:
   *         description: Missing required fields
   */
  router.post('/', async (req: any, res: any, next: any) => {
    try {
      const { agentId, developerId } = req.body;

      if (!agentId || !developerId) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'Both agentId and developerId are required',
        });
      }

      const session = await sessionManager.createSession(agentId, developerId);
      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/{sessionId}/split:
   *   post:
   *     tags: [Sessions]
   *     summary: Split a session at a message index
   *     description: Split a session into two sessions at a specific message
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - atIndex
   *               - developerId
   *             properties:
   *               atIndex:
   *                 type: integer
   *                 description: Message index to split at
   *               developerId:
   *                 type: string
   *                 description: Developer/user ID
   *     responses:
   *       200:
   *         description: New session created from split
   *       400:
   *         description: Invalid request
   */
  router.post('/:sessionId/split', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;
      const { atIndex, developerId } = req.body;

      if (typeof atIndex !== 'number' || !developerId) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'atIndex (number) and developerId are required',
        });
      }

      const newSession = await sessionManager.splitSession(sessionId, atIndex, developerId);
      res.json(newSession);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/{sessionId}/summarize:
   *   post:
   *     tags: [Sessions]
   *     summary: Create an artifact/brief from messages
   *     description: Create a summary artifact from a range of messages in a session
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - fromIndex
   *               - toIndex
   *               - title
   *               - summary
   *               - developerId
   *             properties:
   *               fromIndex:
   *                 type: integer
   *                 description: Starting message index
   *               toIndex:
   *                 type: integer
   *                 description: Ending message index
   *               title:
   *                 type: string
   *                 description: Artifact title
   *               summary:
   *                 type: string
   *                 description: Summary content
   *               developerId:
   *                 type: string
   *                 description: Developer/user ID
   *     responses:
   *       200:
   *         description: Created artifact
   *       400:
   *         description: Invalid request
   */
  router.post('/:sessionId/summarize', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;
      const { fromIndex, toIndex, title, summary, developerId } = req.body;

      if (
        typeof fromIndex !== 'number' ||
        typeof toIndex !== 'number' ||
        !title ||
        !summary ||
        !developerId
      ) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'fromIndex, toIndex, title, summary, and developerId are required',
        });
      }

      const artifact = await sessionManager.createArtifact(
        sessionId,
        fromIndex,
        toIndex,
        summary,
        title,
        developerId
      );
      
      res.json(artifact);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/handoff:
   *   post:
   *     tags: [Sessions]
   *     summary: Create a new session from a handoff
   *     description: Create a new session when handing off work to another agent
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - toAgentId
   *               - developerId
   *               - previousSessionId
   *             properties:
   *               toAgentId:
   *                 type: string
   *                 description: Target agent ID
   *               developerId:
   *                 type: string
   *                 description: Developer/user ID
   *               previousSessionId:
   *                 type: string
   *                 description: Previous session ID
   *               transferArtifacts:
   *                 type: boolean
   *                 default: true
   *                 description: Transfer artifacts to new session
   *               transferAllowedFiles:
   *                 type: boolean
   *                 default: true
   *                 description: Transfer allowed files to new session
   *     responses:
   *       200:
   *         description: Created handoff session
   *       400:
   *         description: Invalid request
   */
  router.post('/handoff', async (req: any, res: any, next: any) => {
    try {
      const { toAgentId, developerId, previousSessionId, transferArtifacts, transferAllowedFiles } = req.body;

      if (!toAgentId || !developerId || !previousSessionId) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'toAgentId, developerId, and previousSessionId are required',
        });
      }

      const session = await sessionManager.createHandoffSession(
        toAgentId,
        developerId,
        previousSessionId,
        transferArtifacts !== false, // default true
        transferAllowedFiles !== false // default true
      );
      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/{sessionId}:
   *   patch:
   *     tags: [Sessions]
   *     summary: Update session metadata
   *     description: Update session artifacts and other metadata
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - artifacts
   *             properties:
   *               artifacts:
   *                 type: array
   *                 items:
   *                   type: object
   *                 description: Updated artifacts array
   *     responses:
   *       200:
   *         description: Updated session
   *       400:
   *         description: Invalid request
   *       404:
   *         description: Session not found
   */
  router.patch('/:sessionId', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;
      const { artifacts } = req.body;

      if (!Array.isArray(artifacts)) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'artifacts array is required',
        });
      }

      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      session.artifacts = artifacts;
      await sessionManager.saveSession(session);

      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/{sessionId}:
   *   delete:
   *     tags: [Sessions]
   *     summary: Delete a session
   *     description: Permanently delete a session and all its messages
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     responses:
   *       204:
   *         description: Session deleted successfully
   *       404:
   *         description: Session not found
   */
  router.delete('/:sessionId', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;

      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          details: `Session ${sessionId} does not exist`,
        });
      }

      await sessionManager.deleteSession(sessionId);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export function createArtifactsRouter(workspaceRoot: string): Router {
  const router = express.Router();
  const storage = createSqliteStorage(workspaceRoot);
  const sessionManager = new SessionManager(workspaceRoot, storage);

  // Initialize session manager
  sessionManager.initialize().catch((error) => {
    console.error('Failed to initialize session manager:', error);
  });

  /**
   * @openapi
   * /api/artifacts:
   *   get:
   *     tags: [Sessions]
   *     summary: List all artifacts
   *     description: Returns all session artifacts
   *     responses:
   *       200:
   *         description: Array of artifacts
   */
  router.get('/', async (req: any, res: any, next: any) => {
    try {
      const artifacts = await sessionManager.listArtifacts();
      res.json(artifacts);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/artifacts/{artifactId}:
   *   get:
   *     tags: [Sessions]
   *     summary: Get artifact by ID
   *     description: Returns detailed information about a specific artifact
   *     parameters:
   *       - in: path
   *         name: artifactId
   *         required: true
   *         schema:
   *           type: string
   *         description: Artifact ID
   *     responses:
   *       200:
   *         description: Artifact data
   *       404:
   *         description: Artifact not found
   */
  router.get('/:artifactId', async (req: any, res: any, next: any) => {
    try {
      const { artifactId } = req.params;
      const artifact = await sessionManager.getArtifact(artifactId);

      if (!artifact) {
        return res.status(404).json({
          error: 'Artifact not found',
          details: `Artifact ${artifactId} does not exist`,
        });
      }

      res.json(artifact);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/merge:
   *   post:
   *     tags: [Sessions]
   *     summary: Merge two sessions
   *     description: Merge two sessions together, keeping messages from both
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - olderSessionId
   *               - newerSessionId
   *             properties:
   *               olderSessionId:
   *                 type: string
   *                 description: ID of the older session (target)
   *               newerSessionId:
   *                 type: string
   *                 description: ID of the newer session (to be merged)
   *     responses:
   *       200:
   *         description: Merged session
   *       400:
   *         description: Invalid request
   */
  router.post('/merge', async (req: any, res: any, next: any) => {
    try {
      const { olderSessionId, newerSessionId } = req.body;

      if (!olderSessionId || !newerSessionId) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'Both olderSessionId and newerSessionId are required',
        });
      }

      if (olderSessionId === newerSessionId) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'Cannot merge a session with itself',
        });
      }

      const mergedSession = await sessionManager.mergeSessionsIntoOlder(olderSessionId, newerSessionId);
      res.json(mergedSession);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/{sessionId}/agents:
   *   post:
   *     tags: [Sessions]
   *     summary: Add agent to session (multi-agent mode)
   *     description: Add another agent to a collaborative session
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - agentId
   *             properties:
   *               agentId:
   *                 type: string
   *                 description: Agent ID to add
   *     responses:
   *       200:
   *         description: Updated session
   *       400:
   *         description: Invalid request
   */
  router.post('/:sessionId/agents', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;
      const { agentId } = req.body;

      if (!agentId) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'agentId is required',
        });
      }

      const updatedSession = await sessionManager.addAgentToSession(sessionId, agentId);
      res.json(updatedSession);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
