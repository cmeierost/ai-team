import { Router } from 'express';
import type { AiTeamClient } from '@ai-team/api-client';
import express from 'express';
import { ChatContextManager, type AgentManager } from '@ai-team/core';
import { type SessionManager, resolveAgentForOperation } from '@ai-team/service';

export function createChatRouter(client: AiTeamClient, workspaceRoot: string, agentManager?: AgentManager, sessionManager?: SessionManager): Router {
  const router = express.Router();
  const contextManager = new ChatContextManager(workspaceRoot);

  /**
   * Helper to resolve agent query to exact agent ID
   */
  const resolveAgentId = (agentQuery: string): string => {
    if (!agentManager) {
      return agentQuery; // Fallback to exact match if no AgentManager
    }
    const resolved = resolveAgentForOperation(agentManager, agentQuery, 'access chat');
    return resolved.id;
  };

  /**
   * @openapi
   * /api/chat/summaries:
   *   get:
   *     tags: [Chat]
   *     summary: Get all chat summaries
   *     description: Returns summaries of all chat sessions across all agents
   *     responses:
   *       200:
   *         description: Array of chat summaries
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   */
  router.get('/summaries', async (req: any, res: any, next: any) => {
    try {
      const summaries = await contextManager.loadSummaries();
      res.json(summaries);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/chat/{agentId}:
   *   get:
   *     tags: [Chat]
   *     summary: Load chat history for an agent
   *     description: Returns all messages from the chat log for the specified agent
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID (exact match or fuzzy query if AgentManager available)
   *       - in: query
   *         name: includeArchived
   *         schema:
   *           type: boolean
   *           default: false
   *         description: Include archived messages in response
   *     responses:
   *       200:
   *         description: Array of chat messages
   *         content:
   *           application/json:
   *             schema:
   *               type: array
   *               items:
   *                 type: object
   */
  router.get('/:agentId', async (req: any, res: any, next: any) => {
    try {
      const agentQuery = req.params.agentId;
      const agentId = resolveAgentId(agentQuery); // Resolve to exact ID
      const includeArchived = req.query.includeArchived === 'true';
      if (!sessionManager) {
        return res.json([]);
      }

      const session = await sessionManager.getLatestSession(agentId);
      if (!session) {
        return res.json([]);
      }

      const messages = await sessionManager.getSessionMessages(session.id);

      // Filter archived messages unless requested
      const filteredMessages = includeArchived
        ? messages
        : messages.filter((msg: any) => !msg.archived);

      res.json(filteredMessages);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/chat/{agentId}:
   *   post:
   *     tags: [Chat]
   *     summary: Send message to agent
   *     description: Send a message to an agent (non-streaming fallback). For real-time experience, use WebSocket.
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - content
   *             properties:
   *               content:
   *                 type: string
   *                 description: Message content
   *     responses:
   *       200:
   *         description: Chat response
   *       400:
   *         description: Invalid request
   */
  router.post('/:agentId', async (req: any, res: any, next: any) => {
    try {
      const agentQuery = req.params.agentId;
      const agentId = resolveAgentId(agentQuery); // Resolve to exact ID
      const { content } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'Message content is required',
        });
      }

      // Use basic chat (non-streaming)
      // Note: For real-time experience, clients should use WebSocket instead
      const result = await client.invoke({
        command: 'chat',
        payload: {
          employeeId: agentId,
          options: { message: content, skipPersistence: true },
        },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/chat/{agentId}/messages/{index}:
   *   put:
   *     tags: [Chat]
   *     summary: Edit a message
   *     description: Edit the content of a specific message in the chat history
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: index
   *         required: true
   *         schema:
   *           type: integer
   *         description: Message index
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - content
   *             properties:
   *               content:
   *                 type: string
   *                 description: New message content
   *     responses:
   *       200:
   *         description: Success
   *       400:
   *         description: Invalid request
   */
  router.put('/:agentId/messages/:index', async (req: any, res: any, next: any) => {
    try {
      const agentQuery = req.params.agentId;
      const agentId = resolveAgentId(agentQuery); // Resolve to exact ID
      const { index } = req.params;
      const { content } = req.body;

      if (!content || typeof content !== 'string') {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'Message content is required',
        });
      }

      const messageIndex = parseInt(index, 10);
      await contextManager.editMessage(agentId, messageIndex, content);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/chat/{agentId}/messages/{index}:
   *   delete:
   *     tags: [Chat]
   *     summary: Delete a message
   *     description: Delete a specific message from the chat history
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: index
   *         required: true
   *         schema:
   *           type: integer
   *         description: Message index
   *     responses:
   *       200:
   *         description: Success
   */
  router.delete('/:agentId/messages/:index', async (req: any, res: any, next: any) => {
    try {
      const agentQuery = req.params.agentId;
      const agentId = resolveAgentId(agentQuery); // Resolve to exact ID
      const { index } = req.params;
      const messageIndex = parseInt(index, 10);

      console.log(`[DELETE] Deleting message ${messageIndex} for agent ${agentId}`);
      await contextManager.deleteMessage(agentId, messageIndex);
      console.log(`[DELETE] Successfully deleted message ${messageIndex}`);

      res.json({ success: true });
    } catch (error) {
      console.error(`[DELETE] Error deleting message:`, error);
      next(error);
    }
  });

  /**
   * @openapi
   * /api/chat/{agentId}/messages/{index}/archive:
   *   patch:
   *     tags: [Chat]
   *     summary: Archive a message
   *     description: Mark a message as archived (hidden by default)
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: index
   *         required: true
   *         schema:
   *           type: integer
   *         description: Message index
   *     responses:
   *       200:
   *         description: Success
   */
  router.patch('/:agentId/messages/:index/archive', async (req: any, res: any, next: any) => {
    try {
      const agentQuery = req.params.agentId;
      const agentId = resolveAgentId(agentQuery); // Resolve to exact ID
      const { index } = req.params;
      const messageIndex = parseInt(index, 10);

      await contextManager.archiveMessage(agentId, messageIndex);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/chat/{agentId}/messages/{index}/unarchive:
   *   patch:
   *     tags: [Chat]
   *     summary: Unarchive a message
   *     description: Restore an archived message
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: index
   *         required: true
   *         schema:
   *           type: integer
   *         description: Message index
   *     responses:
   *       200:
   *         description: Success
   */
  router.patch('/:agentId/messages/:index/unarchive', async (req: any, res: any, next: any) => {
    try {
      const agentQuery = req.params.agentId;
      const agentId = resolveAgentId(agentQuery); // Resolve to exact ID
      const { index } = req.params;
      const messageIndex = parseInt(index, 10);

      await contextManager.unarchiveMessage(agentId, messageIndex);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/chat/{agentId}/stats:
   *   get:
   *     tags: [Chat]
   *     summary: Get message statistics
   *     description: Returns statistics about messages (total, archived, by role, etc.)
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *     responses:
   *       200:
   *         description: Message statistics
   */
  router.get('/:agentId/stats', async (req: any, res: any, next: any) => {
    try {
      const agentQuery = req.params.agentId;
      const agentId = resolveAgentId(agentQuery); // Resolve to exact ID
      const stats = await contextManager.getMessageStats(agentId);

      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/chat/{agentId}/summary:
   *   post:
   *     tags: [Chat]
   *     summary: Create a summary from selected messages
   *     description: Create a summary artifact from specific messages in chat history
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - messageIndices
   *               - title
   *             properties:
   *               messageIndices:
   *                 type: array
   *                 items:
   *                   type: integer
   *                 description: Array of message indices to include
   *               title:
   *                 type: string
   *                 description: Summary title
   *               tags:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Optional tags
   *     responses:
   *       200:
   *         description: Created summary
   *       400:
   *         description: Invalid request
   */
  router.post('/:agentId/summary', async (req: any, res: any, next: any) => {
    try {
      const agentQuery = req.params.agentId;
      const agentId = resolveAgentId(agentQuery); // Resolve to exact ID
      const { messageIndices, title, tags } = req.body;

      if (!Array.isArray(messageIndices) || !title) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'messageIndices (array) and title (string) are required',
        });
      }

      const summary = await contextManager.createSummary(agentId, messageIndices, title, tags);

      res.json(summary);
    } catch (error) {
      next(error);
    }
  });

  /**
   * @openapi
   * /api/chat/{agentId}/messages/{index}/annotate:
   *   post:
   *     tags: [Chat]
   *     summary: Add annotation to a message
   *     description: Add metadata annotation to a specific message
   *     parameters:
   *       - in: path
   *         name: agentId
   *         required: true
   *         schema:
   *           type: string
   *         description: Agent ID
   *       - in: path
   *         name: index
   *         required: true
   *         schema:
   *           type: integer
   *         description: Message index
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - type
   *               - content
   *             properties:
   *               type:
   *                 type: string
   *                 description: Annotation type
   *               content:
   *                 type: string
   *                 description: Annotation content
   *               tags:
   *                 type: array
   *                 items:
   *                   type: string
   *                 description: Optional tags
   *     responses:
   *       200:
   *         description: Success
   *       400:
   *         description: Invalid request
   */
  router.post('/:agentId/messages/:index/annotate', async (req: any, res: any, next: any) => {
    try {
      const agentQuery = req.params.agentId;
      const agentId = resolveAgentId(agentQuery); // Resolve to exact ID
      const { index } = req.params;
      const { type, content, tags } = req.body;

      if (!type || !content) {
        return res.status(400).json({
          error: 'Invalid request',
          details: 'type and content are required',
        });
      }

      const messageIndex = parseInt(index, 10);
      const annotation = {
        type,
        content,
        timestamp: new Date().toISOString(),
        tags,
      };

      await contextManager.addAnnotation(agentId, messageIndex, annotation);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
