import { Router } from 'express';
import { SessionManager } from '@ai-team/service';
import express from 'express';

export function createSessionsRouter(workspaceRoot: string): Router {
  const router = express.Router();
  const sessionManager = new SessionManager(workspaceRoot);

  // Initialize session manager
  sessionManager.initialize().catch((error) => {
    console.error('Failed to initialize session manager:', error);
  });

  // GET /api/sessions/:agentId/latest - Get latest session for an agent
  router.get('/:agentId/latest', async (req: any, res: any, next: any) => {
    try {
      const { agentId } = req.params;
      const session = await sessionManager.getLatestSession(agentId);
      
      if (!session) {
        return res.status(404).json({
          error: 'No session found',
          details: `No sessions exist for agent ${agentId}`,
        });
      }

      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/sessions - List sessions for an agent
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

  // GET /api/sessions/:sessionId - Get session by ID
  router.get('/:sessionId', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;
      const session = await sessionManager.getSession(sessionId);

      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          details: `Session ${sessionId} does not exist`,
        });
      }

      res.json(session);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/sessions/:sessionId/messages - Get messages for a session
  router.get('/:sessionId/messages', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;
      const messages = await sessionManager.getSessionMessages(sessionId);
      res.json(messages);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/sessions - Create a new session
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

  // POST /api/sessions/:sessionId/split - Split a session at a message index
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

  // POST /api/sessions/:sessionId/summarize - Create an artifact/brief from messages
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

  // PATCH /api/sessions/:sessionId - Update session metadata
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

  return router;
}

export function createArtifactsRouter(workspaceRoot: string): Router {
  const router = express.Router();
  const sessionManager = new SessionManager(workspaceRoot);

  // Initialize session manager
  sessionManager.initialize().catch((error) => {
    console.error('Failed to initialize session manager:', error);
  });

  // GET /api/artifacts - List all artifacts
  router.get('/', async (req: any, res: any, next: any) => {
    try {
      const artifacts = await sessionManager.listArtifacts();
      res.json(artifacts);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/artifacts/:artifactId - Get artifact by ID
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

  return router;
}
