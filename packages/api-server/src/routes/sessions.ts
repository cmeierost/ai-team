import express, { Router } from 'express';
import { SessionManager, createSqliteStorage } from '@ai-team/service';
import type { AgentManager } from '@ai-team/core';
import { LlmService } from '@ai-team/core';

export function createSessionsRouter(workspaceRoot: string, agentManager?: AgentManager, sharedSessionManager?: SessionManager): Router {
  const router = express.Router();
  const sessionManager = sharedSessionManager
    ?? new SessionManager(workspaceRoot, createSqliteStorage(workspaceRoot), agentManager);

  if (!sharedSessionManager) {
    // Only initialize if we had to create our own instance
    sessionManager.initialize().catch((error) => {
      console.error('Failed to initialize session manager:', error);
    });
  }

  type ToolPhase = 'request' | 'start' | 'result' | 'error' | 'denied';
  interface SessionToolDenial {
    kind: 'user-denied' | 'policy-denied' | 'execution-failed';
    reasonCode: string;
    message: string;
    blockedPaths?: string[];
    alternativeContexts?: Array<{ contextId: string; allowedPaths: string[] }>;
    handoffRecommendation?: {
      possible: boolean;
      requiresUserApproval: true;
      contexts: Array<{ contextId: string; allowedPaths: string[] }>;
    };
  }

  interface SessionToolResult {
    toolName: string;
    outcome: 'result' | 'error' | 'denied';
    result?: unknown;
    denial?: SessionToolDenial;
  }

  interface SessionActivatedTool {
    toolName: string;
    toolPhase?: ToolPhase;
    message?: string;
    toolResult?: SessionToolResult;
    toolDenial?: SessionToolDenial;
    timestamp: string;
  }

  const SESSION_META_PREFIX = '<!-- ai-team:session-meta ';
  const SESSION_META_SUFFIX = ' -->';

  const readSessionMeta = (notes?: string): { cleanNotes?: string; activatedTools: SessionActivatedTool[] } => {
    if (!notes?.includes(SESSION_META_PREFIX)) {
      return { cleanNotes: notes, activatedTools: [] };
    }

    const start = notes.lastIndexOf(SESSION_META_PREFIX);
    if (start < 0) {
      return { cleanNotes: notes, activatedTools: [] };
    }
    const afterPrefix = start + SESSION_META_PREFIX.length;
    const end = notes.indexOf(SESSION_META_SUFFIX, afterPrefix);
    if (end < 0) {
      return { cleanNotes: notes, activatedTools: [] };
    }

    const json = notes.slice(afterPrefix, end);
    const cleanNotes = notes.slice(0, start).trimEnd() || undefined;

    try {
      const parsed = JSON.parse(json) as { activatedTools?: SessionActivatedTool[] };
      return {
        cleanNotes,
        activatedTools: Array.isArray(parsed.activatedTools) ? parsed.activatedTools : [],
      };
    } catch {
      return { cleanNotes: notes, activatedTools: [] };
    }
  };

  const writeSessionMeta = (cleanNotes: string | undefined, activatedTools: SessionActivatedTool[]): string | undefined => {
    if (!activatedTools.length) {
      return cleanNotes;
    }

    const meta = `${SESSION_META_PREFIX}${JSON.stringify({ activatedTools })}${SESSION_META_SUFFIX}`;
    return cleanNotes ? `${cleanNotes}\n\n${meta}` : meta;
  };

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
      const sessions = await sessionManager.listRecentSessions(limit);

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
   * /api/sessions/{sessionId}/messages/{timestamp}:
   *   delete:
   *     tags: [Sessions]
   *     summary: Delete a message from a session
   *     description: Deletes a single message identified by its timestamp from a specific session
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Session ID
   *       - in: path
   *         name: timestamp
   *         required: true
   *         schema:
   *           type: string
   *         description: ISO timestamp of the message to delete
   *     responses:
   *       200:
   *         description: Message deleted
   *       404:
   *         description: Session or message not found
   */
  router.delete('/:sessionId/messages/:timestamp', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;
      const timestamp = decodeURIComponent(req.params.timestamp);

      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          details: `Session ${sessionId} does not exist`,
        });
      }

      const deleted = await sessionManager.deleteSessionMessage(sessionId, timestamp);
      if (!deleted) {
        return res.status(404).json({
          error: 'Message not found',
          details: `No message found in session ${sessionId} at timestamp ${timestamp}`,
        });
      }

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/sessions/{sessionId}/thread:
   *   get:
   *     tags: [Sessions]
   *     summary: Get the full session chain for a handoff thread
   *     description: |
   *       Walks the previousSessionId chain from the given session back to the root.
   *       Returns all sessions in the thread ordered root → leaf, each with their
   *       messages. Messages belonging to the same handoff event share a handoffId,
   *       enabling cross-session message linking in the UI.
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: Any session ID in the thread (root or any descendant)
   *     responses:
   *       200:
   *         description: Full thread with all sessions and messages
   *       404:
   *         description: Session not found
   */
  router.get('/:sessionId/thread', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;

      const rootCheck = await sessionManager.getSession(sessionId);
      if (!rootCheck) {
        return res.status(404).json({
          error: 'Session not found',
          details: `Session ${sessionId} does not exist`,
        });
      }

      const chain = await sessionManager.getSessionChain(sessionId);

      const sessions = await Promise.all(
        chain.map(async (session) => {
          const messages = await sessionManager.getSessionMessages(session.id);
          const ids = session.agentIds ?? (session.agentId ? [session.agentId] : []);
          const agentNames = ids.map((id) => {
            try { return agentManager?.getAgent(id)?.name ?? id; } catch { return id; }
          });
          return {
            sessionId: session.id,
            agentIds: ids,
            agentNames,
            developerId: session.developerId ?? null,
            title: session.title ?? null,
            startedAt: session.startedAt,
            lastActivityAt: session.lastActivityAt,
            previousSessionId: session.previousSessionId ?? null,
            mergedFromSessionIds: session.mergedFromSessionIds ?? null,
            messageCount: messages.length,
            messages,
          };
        }),
      );

      // Build a cross-session handoff edge index from messages that carry handoffId + session links.
      // Each unique handoffId represents one handoff event with a FROM and TO side.
      const handoffMap = new Map<string, { handoffId: string; fromSessionId: string | null; toSessionId: string | null; fromAgentIds: string[]; toAgentIds: string[] }>();
      for (const s of sessions) {
        for (const m of s.messages) {
          if (!m.handoffId) continue;
          const existing = handoffMap.get(m.handoffId);
          if (!existing) {
            handoffMap.set(m.handoffId, {
              handoffId: m.handoffId,
              fromSessionId: m.handoffFromSessionId ?? null,
              toSessionId: m.handoffToSessionId ?? null,
              fromAgentIds: [],
              toAgentIds: [],
            });
          }
        }
        // Populate agent IDs from session membership
        for (const [, edge] of handoffMap) {
          if (edge.fromSessionId === s.sessionId) edge.fromAgentIds = s.agentIds;
          if (edge.toSessionId === s.sessionId) edge.toAgentIds = s.agentIds;
        }
      }
      const handoffs = Array.from(handoffMap.values());

      res.json({
        rootSessionId: sessions[0]?.sessionId ?? sessionId,
        currentSessionId: sessionId,
        depth: sessions.length,
        handoffs,
        sessions,
      });
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
  router.post('/:sessionId/generate-title', async (req: any, res: any, next: any) => {
    try {
      const { sessionId } = req.params;
      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      const llm = new LlmService(workspaceRoot);
      await llm.initialize();
      const title = await sessionManager.generateTitle(sessionId, llm);
      res.json({ title });
    } catch (error) {
      next(error);
    }
  });

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
      const { artifacts, activatedTools, notes, title } = req.body;

      if (artifacts !== undefined && !Array.isArray(artifacts)) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'artifacts must be an array when provided',
        });
      }

      if (activatedTools !== undefined && !Array.isArray(activatedTools)) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'activatedTools must be an array when provided',
        });
      }

      if (notes !== undefined && notes !== null && typeof notes !== 'string') {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'notes must be a string or null when provided',
        });
      }

      if (artifacts === undefined && activatedTools === undefined && notes === undefined && title === undefined) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'at least one of artifacts, activatedTools, notes, or title must be provided',
        });
      }

      const session = await sessionManager.getSession(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      if (artifacts !== undefined) {
        session.artifacts = artifacts;
      }

      if (title !== undefined) {
        session.title = title;
      }

      if (activatedTools !== undefined || notes !== undefined) {
        const { cleanNotes, activatedTools: existingActivatedTools } = readSessionMeta(session.notes);
        const nextCleanNotes = notes === undefined
          ? cleanNotes
          : (notes === null ? undefined : notes);
        const nextActivatedTools = activatedTools === undefined
          ? existingActivatedTools
          : (activatedTools as SessionActivatedTool[]);
        session.notes = writeSessionMeta(nextCleanNotes, nextActivatedTools);
      }

      await sessionManager.saveSession(session);

      const { activatedTools: currentActivatedTools } = readSessionMeta(session.notes);
      res.json({
        ...session,
        activatedTools: currentActivatedTools,
      });
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

export function createArtifactsRouter(workspaceRoot: string, sharedSessionManager?: SessionManager): Router {
  const router = express.Router();
  const sessionManager = sharedSessionManager
    ?? new SessionManager(workspaceRoot, createSqliteStorage(workspaceRoot));

  if (!sharedSessionManager) {
    sessionManager.initialize().catch((error) => {
      console.error('Failed to initialize session manager:', error);
    });
  }

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
