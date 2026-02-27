import { Router } from 'express';
import type { AiTeamClient } from '@ai-team/api-client';
import { readFile, access, writeFile } from 'fs/promises';
import { join } from 'path';
import express from 'express';
import { ChatContextManager } from '@ai-team/core';

export function createChatRouter(client: AiTeamClient, workspaceRoot: string): Router {
  const router = express.Router();
  const contextManager = new ChatContextManager(workspaceRoot);

  // GET /api/chat/summaries - Get all summaries (must come before /:agentId routes)
  router.get('/summaries', async (req: any, res: any, next: any) => {
    try {
      const summaries = await contextManager.loadSummaries();
      res.json(summaries);
    } catch (error) {
      next(error);
    }
  });

  // GET /api/chat/:agentId - Load chat history
  router.get('/:agentId', async (req: any, res: any, next: any) => {
    try {
      const { agentId } = req.params;
      const includeArchived = req.query.includeArchived === 'true';
      const chatLogPath = join(workspaceRoot, '.ai-team', 'private', 'chats', `${agentId}.jsonl`);

      // Check if file exists
      try {
        await access(chatLogPath);
      } catch {
        // No chat history yet
        return res.json([]);
      }

      // Read and parse JSONL
      const content = await readFile(chatLogPath, 'utf-8');
      const messages = content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line));

      // Filter archived messages unless requested
      const filteredMessages = includeArchived 
        ? messages 
        : messages.filter((msg: any) => !msg.archived);

      res.json(filteredMessages);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/chat/:agentId - Send message (fallback for non-streaming)
  router.post('/:agentId', async (req: any, res: any, next: any) => {
    try {
      const { agentId } = req.params;
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
          options: { message: content },
        },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // PUT /api/chat/:agentId/messages/:index - Edit a message
  router.put('/:agentId/messages/:index', async (req: any, res: any, next: any) => {
    try {
      const { agentId, index } = req.params;
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

  // DELETE /api/chat/:agentId/messages/:index - Delete a message
  router.delete('/:agentId/messages/:index', async (req: any, res: any, next: any) => {
    try {
      const { agentId, index } = req.params;
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

  // PATCH /api/chat/:agentId/messages/:index/archive - Archive a message
  router.patch('/:agentId/messages/:index/archive', async (req: any, res: any, next: any) => {
    try {
      const { agentId, index } = req.params;
      const messageIndex = parseInt(index, 10);

      await contextManager.archiveMessage(agentId, messageIndex);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // PATCH /api/chat/:agentId/messages/:index/unarchive - Unarchive a message
  router.patch('/:agentId/messages/:index/unarchive', async (req: any, res: any, next: any) => {
    try {
      const { agentId, index } = req.params;
      const messageIndex = parseInt(index, 10);

      await contextManager.unarchiveMessage(agentId, messageIndex);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });

  // GET /api/chat/:agentId/stats - Get message statistics
  router.get('/:agentId/stats', async (req: any, res: any, next: any) => {
    try {
      const { agentId } = req.params;
      const stats = await contextManager.getMessageStats(agentId);

      res.json(stats);
    } catch (error) {
      next(error);
    }
  });

  // POST /api/chat/:agentId/summary - Create a summary from selected messages
  router.post('/:agentId/summary', async (req: any, res: any, next: any) => {
    try {
      const { agentId } = req.params;
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

  // POST /api/chat/:agentId/messages/:index/annotate - Add annotation to a message
  router.post('/:agentId/messages/:index/annotate', async (req: any, res: any, next: any) => {
    try {
      const { agentId, index } = req.params;
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
