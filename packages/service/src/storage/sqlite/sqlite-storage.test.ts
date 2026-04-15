import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteMessageStorage } from './sqlite-storage.js';
import type { ChatMessage } from '@ai-team/core';

const tempDirs: string[] = [];

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-storage-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0, tempDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('SqliteMessageStorage', () => {
  let storage: SqliteMessageStorage;
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await createTempWorkspace();
    storage = new SqliteMessageStorage(workspaceRoot);
    await storage.migrate();
  });

  afterEach(async () => {
    await storage.close();
  });

  describe('Sessions', () => {
    it('creates and retrieves a session', async () => {
      const session = await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      expect(session.id).toBeDefined();
      expect(session.agentIds).toEqual(['architect-agent']);
      expect(session.developerId).toBe('developer-1');

      const retrieved = await storage.getSession(session.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(session.id);
      expect(retrieved?.agentIds).toEqual(['architect-agent']);
    });

    it('lists sessions with filtering', async () => {
      // Create multiple sessions
      const session1 = await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      await storage.createSession({
        agentIds: ['backend-agent'],
        agentId: 'backend-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-2',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      // List all sessions
      const allSessions = await storage.listSessions();
      expect(allSessions).toHaveLength(3);

      // Filter by agent
      const architectSessions = await storage.listSessions({ agentId: 'architect-agent' });
      expect(architectSessions).toHaveLength(2);

      // Filter by developer
      const dev1Sessions = await storage.listSessions({ developerId: 'developer-1' });
      expect(dev1Sessions).toHaveLength(2);

      // Filter by both
      const filtered = await storage.listSessions({
        agentId: 'architect-agent',
        developerId: 'developer-1',
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe(session1.id);
    });

    it('updates session metadata', async () => {
      const session = await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      await storage.updateSession(session.id, {
        title: 'Authentication Refactor',
        notes: 'Planning JWT implementation',
        artifacts: ['brief-auth-design'],
        allowedFiles: ['src/auth/**'],
      });

      const updated = await storage.getSession(session.id);
      expect(updated?.title).toBe('Authentication Refactor');
      expect(updated?.notes).toBe('Planning JWT implementation');
      expect(updated?.artifacts).toEqual(['brief-auth-design']);
      expect(updated?.allowedFiles).toEqual(['src/auth/**']);
    });

    it('deletes a session and its messages', async () => {
      const session = await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      // Add a message
      await storage.insertMessage(session.id, {
        timestamp: new Date().toISOString(),
        from: 'developer-1',
        isHuman: true,
        content: 'Hello',
      });

      // Delete session
      const deleted = await storage.deleteSession(session.id);
      expect(deleted).toBe(true);

      // Verify session is gone
      const retrieved = await storage.getSession(session.id);
      expect(retrieved).toBeNull();

      // Verify messages are gone too
      const messages = await storage.getSessionMessages(session.id);
      expect(messages).toHaveLength(0);
    });

    it('adds and removes agents from session', async () => {
      const session = await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      // Add another agent
      await storage.addSessionAgent(session.id, 'backend-agent');

      const updated = await storage.getSession(session.id);
      expect(updated?.agentIds).toContain('architect-agent');
      expect(updated?.agentIds).toContain('backend-agent');

      // Remove an agent
      await storage.removeSessionAgent(session.id, 'architect-agent');

      const final = await storage.getSession(session.id);
      expect(final?.agentIds).not.toContain('architect-agent');
      expect(final?.agentIds).toContain('backend-agent');
    });
  });

  describe('Messages', () => {
    let sessionId: string;

    beforeEach(async () => {
      const session = await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });
      sessionId = session.id;
    });

    it('creates and retrieves messages', async () => {
      const message: ChatMessage = {
        timestamp: new Date().toISOString(),
        from: 'developer-1',
        isHuman: true,
        content: 'How do I implement authentication?',
      };

      const result = await storage.insertMessage(sessionId, message);
      expect(result.messageId).toBeDefined();
      expect(result.timestamp).toBeDefined();

      const messages = await storage.getSessionMessages(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('How do I implement authentication?');
      expect(messages[0].from).toBe('developer-1');
      expect(messages[0].isHuman).toBe(true);
    });

    it('preserves message metadata (context, tool_calls, suggestions)', async () => {
      const message: ChatMessage = {
        timestamp: new Date().toISOString(),
        from: 'architect-agent',
        isHuman: false,
        content: 'Here is the implementation plan',
        context: ['src/auth/login.ts', 'src/auth/jwt.ts'],
        tool_calls: [
          {
            tool: 'fs_read',
            params: { path: 'src/auth/login.ts' },
            result: { content: 'file content' },
            resultLlm: 'File: src/auth/login.ts\nLines: 1-1 of 1\nFull file: yes\n\nfile content',
          },
        ],
        suggestions: [
          {
            type: 'code_improvement',
            file: 'src/auth/jwt.ts',
            line: 42,
            description: 'Add token validation',
            code: 'function validateToken(token: string) {...}',
          },
        ],
      };

      await storage.insertMessage(sessionId, message);

      const messages = await storage.getSessionMessages(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].context).toHaveLength(2);
      expect(messages[0].context).toContain('src/auth/login.ts');
      expect(messages[0].context).toContain('src/auth/jwt.ts');
      expect(messages[0].tool_calls).toHaveLength(1);
      expect(messages[0].tool_calls![0].tool).toBe('fs_read');
      expect(messages[0].tool_calls![0].resultLlm).toBe(
        'File: src/auth/login.ts\nLines: 1-1 of 1\nFull file: yes\n\nfile content'
      );
      expect(messages[0].suggestions).toHaveLength(1);
      expect(messages[0].suggestions![0].file).toBe('src/auth/jwt.ts');
    });

    it('updates the readable result_llm text for a stored tool call', async () => {
      await storage.insertMessage(sessionId, {
        timestamp: new Date().toISOString(),
        from: 'architect-agent',
        isHuman: false,
        content: '[tool:fs_read] original',
        tool_calls: [
          {
            tool: 'fs_read',
            params: { filePath: 'src/example.ts' },
            result: { path: 'src/example.ts', content: 'const x = 1;' },
            resultLlm: 'File: src/example.ts\nLines: 1-1 of 1\nFull file: yes\n\nconst x = 1;',
          },
        ],
      });

      const initialMessages = await storage.getSessionMessages(sessionId);
      const toolCallId = initialMessages[0].tool_calls?.[0]?.id;
      expect(toolCallId).toBeDefined();

      await storage.updateToolCallLlmResult(
        toolCallId!,
        'File: src/example.ts\nLines: 1-1 of 1\nFull file: yes\n\nconst x = 2;'
      );

      const updatedMessages = await storage.getSessionMessages(sessionId);
      expect(updatedMessages[0].tool_calls?.[0]?.resultLlm).toBe(
        'File: src/example.ts\nLines: 1-1 of 1\nFull file: yes\n\nconst x = 2;'
      );
    });

    it('maintains message order by timestamp', async () => {
      const timestamps = [
        '2026-03-01T10:00:00.000Z',
        '2026-03-01T10:01:00.000Z',
        '2026-03-01T10:02:00.000Z',
      ];

      for (const timestamp of timestamps) {
        await storage.insertMessage(sessionId, {
          timestamp,
          from: 'developer-1',
          isHuman: true,
          content: `Message at ${timestamp}`,
        });
      }

      const messages = await storage.getSessionMessages(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].timestamp).toBe(timestamps[0]);
      expect(messages[1].timestamp).toBe(timestamps[1]);
      expect(messages[2].timestamp).toBe(timestamps[2]);
    });

    it('archives and unarchives messages', async () => {
      const timestamp = new Date().toISOString();
      await storage.insertMessage(sessionId, {
        timestamp,
        from: 'developer-1',
        isHuman: true,
        content: 'Test message',
      });

      // Get all messages (including archived)
      let messages = await storage.getSessionMessages(sessionId, true);
      expect(messages[0].archived).toBeUndefined();

      // Archive the message
      await storage.archiveMessage(sessionId, timestamp);

      // Check archived flag
      messages = await storage.getSessionMessages(sessionId, true);
      expect(messages[0].archived).toBe(true);

      // Default excludes archived
      messages = await storage.getSessionMessages(sessionId);
      expect(messages).toHaveLength(0);
    });

    it('deletes messages', async () => {
      const timestamp = new Date().toISOString();
      await storage.insertMessage(sessionId, {
        timestamp,
        from: 'developer-1',
        isHuman: true,
        content: 'Test message',
      });

      let messages = await storage.getSessionMessages(sessionId);
      expect(messages).toHaveLength(1);

      const deleted = await storage.deleteMessage(sessionId, timestamp);
      expect(deleted).toBe(true);

      messages = await storage.getSessionMessages(sessionId);
      expect(messages).toHaveLength(0);
    });

    it('filters messages by sender', async () => {
      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:00:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'Human message',
      });

      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'Agent message',
      });

      const humanMessages = await storage.queryMessages({
        sessionId,
        isHuman: true,
      });
      expect(humanMessages).toHaveLength(1);
      expect(humanMessages[0].from).toBe('developer-1');

      const agentMessages = await storage.queryMessages({
        sessionId,
        fromId: 'architect-agent',
      });
      expect(agentMessages).toHaveLength(1);
      expect(agentMessages[0].from).toBe('architect-agent');
    });

    it('searches messages by content', async () => {
      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:00:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'How do I implement JWT authentication?',
      });

      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'For authentication, use the jsonwebtoken library.',
      });

      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:02:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'What about error handling?',
      });

      const results = await storage.searchMessages('authentication', sessionId);
      expect(results).toHaveLength(2);
      expect(results.some((m) => m.content.includes('JWT'))).toBe(true);
      expect(results.some((m) => m.content.includes('jsonwebtoken'))).toBe(true);
    });

    it('searches messages with FTS5 boolean operators', async () => {
      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:00:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'How do I implement JWT authentication?',
      });

      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'Use the jsonwebtoken library for authentication.',
      });

      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:02:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'What about JWT validation and error handling?',
      });

      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:03:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'Use OAuth2 for API authentication.',
      });

      // Boolean AND: both terms must be present
      const andResults = await storage.searchMessages('JWT AND validation', sessionId);
      expect(andResults).toHaveLength(1);
      expect(andResults[0].content).toContain('validation');

      // Boolean OR: either term can be present
      const orResults = await storage.searchMessages('JWT OR OAuth2', sessionId);
      expect(orResults.length).toBeGreaterThanOrEqual(3);

      // Boolean NOT: exclude term
      const notResults = await storage.searchMessages('authentication NOT OAuth2', sessionId);
      expect(notResults.every((m) => !m.content.includes('OAuth2'))).toBe(true);
      expect(notResults.length).toBeGreaterThan(0);
    });

    it('searches messages with phrase queries', async () => {
      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:00:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'I need help with error handling strategies.',
      });

      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'For error handling, use try-catch blocks.',
      });

      await storage.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:02:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'Errors occur during runtime in handling module.',
      });

      // Phrase query: exact phrase match
      const results = await storage.searchMessages('"error handling"', sessionId);
      expect(results).toHaveLength(2);
      expect(results.every((m) => m.content.toLowerCase().includes('error handling'))).toBe(true);
    });
  });

  describe('Notes', () => {
    it('creates and retrieves notes', async () => {
      const note = await storage.createNote({
        agentId: 'architect-agent',
        title: 'Authentication Refactor',
        content: 'Consider migrating from session cookies to JWT tokens for better scalability.',
        tags: ['authentication', 'jwt', 'refactoring'],
      });

      expect(note.id).toBeDefined();
      expect(note.agentId).toBe('architect-agent');
      expect(note.title).toBe('Authentication Refactor');
      expect(note.createdAt).toBeDefined();
      expect(note.updatedAt).toBeDefined();

      const retrieved = await storage.getNote(note.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe(note.content);
      expect(retrieved?.tags).toEqual(['authentication', 'jwt', 'refactoring']);
    });

    it('lists notes by agent', async () => {
      await storage.createNote({
        agentId: 'architect-agent',
        content: 'Note 1 for architect',
      });

      await storage.createNote({
        agentId: 'architect-agent',
        content: 'Note 2 for architect',
      });

      await storage.createNote({
        agentId: 'backend-agent',
        content: 'Note for backend',
      });

      const architectNotes = await storage.listAgentNotes('architect-agent');
      expect(architectNotes).toHaveLength(2);

      const backendNotes = await storage.listAgentNotes('backend-agent');
      expect(backendNotes).toHaveLength(1);
    });

    it('updates notes', async () => {
      const note = await storage.createNote({
        agentId: 'architect-agent',
        title: 'Initial Title',
        content: 'Initial content',
        tags: ['tag1'],
      });

      await new Promise((r) => setTimeout(r, 5));
      await storage.updateNote(note.id, {
        title: 'Updated Title',
        content: 'Updated content with more details',
        tags: ['tag1', 'tag2', 'updated'],
      });

      const updated = await storage.getNote(note.id);
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.content).toBe('Updated content with more details');
      expect(updated?.tags).toEqual(['tag1', 'tag2', 'updated']);
      expect(updated?.updatedAt).not.toBe(note.updatedAt);
    });

    it('deletes notes', async () => {
      const note = await storage.createNote({
        agentId: 'architect-agent',
        content: 'Test note',
      });

      const deleted = await storage.deleteNote(note.id);
      expect(deleted).toBe(true);

      const retrieved = await storage.getNote(note.id);
      expect(retrieved).toBeNull();
    });

    it('searches notes by content', async () => {
      await storage.createNote({
        agentId: 'architect-agent',
        title: 'JWT Authentication',
        content: 'Implement JWT-based authentication system',
        tags: ['security'],
      });

      await storage.createNote({
        agentId: 'architect-agent',
        title: 'Database Migration',
        content: 'Plan migration from MySQL to PostgreSQL',
        tags: ['database'],
      });

      await storage.createNote({
        agentId: 'backend-agent',
        title: 'API Authentication',
        content: 'Add OAuth2 authentication to REST API',
        tags: ['api', 'security'],
      });

      // Search all notes
      const allResults = await storage.searchNotes('authentication');
      expect(allResults).toHaveLength(2);

      // Search notes for specific agent
      const architectResults = await storage.searchNotes('authentication', 'architect-agent');
      expect(architectResults).toHaveLength(1);
      expect(architectResults[0].title).toBe('JWT Authentication');
    });

    it('searches notes with FTS5 features', async () => {
      await storage.createNote({
        agentId: 'developer-1',
        title: 'API Testing Guide',
        content: 'We need to test all API endpoints and validate responses.',
        tags: ['testing', 'api'],
      });

      await storage.createNote({
        agentId: 'developer-1',
        title: 'Unit Test Configuration',
        content:
          'Configure the test runner to execute unit tests automatically. Mock API responses for testing.',
        tags: ['testing', 'config'],
      });

      await storage.createNote({
        agentId: 'developer-1',
        title: 'Deployment Guide',
        content: 'Deploy the application to production after running tests.',
        tags: ['deployment', 'testing'],
      });

      // FTS5 word matching: "test" should match all notes containing the word "test" (case insensitive)
      const testResults = await storage.searchNotes('test', 'developer-1');
      expect(testResults.length).toBeGreaterThanOrEqual(2); // Found in title and content

      // FTS5 word matching: "testing" should match notes with that exact word in title or content
      const testingResults = await storage.searchNotes('testing', 'developer-1');
      expect(testingResults.length).toBeGreaterThanOrEqual(1); // Found in title (note: tags are not indexed)

      // FTS5 word matching: "API" should match by title
      const apiResults = await storage.searchNotes('API', 'developer-1');
      expect(apiResults.length).toBeGreaterThanOrEqual(2); // Found in title and content
    });

    it('searches notes with FTS5 operators', async () => {
      await storage.createNote({
        agentId: 'developer-1',
        title: 'API Security Best Practices',
        content: 'Implement HTTPS and JWT authentication for API endpoints.',
        tags: ['security', 'api'],
      });

      await storage.createNote({
        agentId: 'developer-1',
        title: 'Database Security',
        content: 'Use encryption for sensitive data in the database.',
        tags: ['security', 'database'],
      });

      await storage.createNote({
        agentId: 'developer-1',
        title: 'API Rate Limiting',
        content: 'Configure rate limiting for public API endpoints.',
        tags: ['api', 'performance'],
      });

      // Boolean AND
      const andResults = await storage.searchNotes('API AND security', 'developer-1');
      expect(andResults).toHaveLength(1);
      expect(andResults[0].title).toContain('API Security');

      // Boolean OR
      const orResults = await storage.searchNotes('authentication OR encryption', 'developer-1');
      expect(orResults).toHaveLength(2);

      // Phrase query
      const phraseResults = await storage.searchNotes('"rate limiting"', 'developer-1');
      expect(phraseResults).toHaveLength(1);
      expect(phraseResults[0].content).toContain('rate limiting');
    });
  });

  describe('Statistics', () => {
    it('returns accurate storage statistics', async () => {
      // Create sessions
      const session1 = await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const session2 = await storage.createSession({
        agentIds: ['backend-agent'],
        agentId: 'backend-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      // Add messages
      await storage.insertMessage(session1.id, {
        timestamp: new Date().toISOString(),
        from: 'developer-1',
        isHuman: true,
        content: 'Message 1',
      });

      await storage.insertMessage(session1.id, {
        timestamp: new Date().toISOString(),
        from: 'architect-agent',
        isHuman: false,
        content: 'Message 2',
      });

      await storage.insertMessage(session2.id, {
        timestamp: new Date().toISOString(),
        from: 'developer-1',
        isHuman: true,
        content: 'Message 3',
      });

      const stats = await storage.getStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.totalMessages).toBe(3);
      expect(stats.schemaVersion).toBe(7);
      expect(stats.storageSize).toBeGreaterThan(0);
    });

    it('stores and retrieves message importance field', async () => {
      const session = await storage.createSession({
        agentIds: ['agent-1'],
        agentId: 'agent-1',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      await storage.insertMessage(session.id, {
        timestamp: new Date().toISOString(),
        from: 'agent-1',
        content: 'Hi there! How can I help?',
        importance: 'low',
      });

      await storage.insertMessage(session.id, {
        timestamp: new Date().toISOString(),
        from: 'developer-1',
        isHuman: true,
        content: 'Please help me with X.',
        // importance omitted → undefined (normal)
      });

      const messages = await storage.getSessionMessages(session.id);
      expect(messages).toHaveLength(2);
      expect(messages[0].importance).toBe('low');
      expect(messages[1].importance).toBeUndefined();
    });
  });

  describe('Complex Operations', () => {
    it('handles session merge scenario', async () => {
      // Create two sessions
      const session1 = await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: '2026-03-01T10:00:00.000Z',
        lastActivityAt: '2026-03-01T10:00:00.000Z',
        artifacts: [],
        allowedFiles: [],
      });

      const session2 = await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: '2026-03-01T11:00:00.000Z',
        lastActivityAt: '2026-03-01T11:00:00.000Z',
        artifacts: [],
        allowedFiles: [],
      });

      // Add messages to both sessions
      await storage.insertMessage(session1.id, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'Session 1 message',
      });

      await storage.insertMessage(session2.id, {
        timestamp: '2026-03-01T11:01:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'Session 2 message',
      });

      // Merge session2 messages into session1
      const session2Messages = await storage.getSessionMessages(session2.id);
      for (const msg of session2Messages) {
        await storage.insertMessage(session1.id, msg);
      }

      // Update session1 metadata
      await storage.updateSession(session1.id, {
        lastActivityAt: '2026-03-01T11:01:00.000Z',
        mergedFromSessionIds: [session2.id],
      });

      // Delete session2
      await storage.deleteSession(session2.id);

      // Verify
      const session1Messages = await storage.getSessionMessages(session1.id);
      expect(session1Messages).toHaveLength(2);

      const session2Exists = await storage.getSession(session2.id);
      expect(session2Exists).toBeNull();

      const merged = await storage.getSession(session1.id);
      expect(merged?.mergedFromSessionIds).toBeDefined();
      expect(merged?.mergedFromSessionIds).toContain(session2.id);
    });

    it('handles multi-agent session workflow', async () => {
      // Create session with one agent
      const session = await storage.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      // Add messages from first agent
      await storage.insertMessage(session.id, {
        timestamp: '2026-03-01T10:00:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'Architecture plan ready',
      });

      // Add second agent to session
      await storage.addSessionAgent(session.id, 'backend-agent');

      // Add handoff message
      await storage.insertMessage(session.id, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'architect-agent',
        to: 'backend-agent',
        isHuman: false,
        content: 'Handing off to backend agent',
        handoffType: 'agent-briefing',
        targetAgentId: 'backend-agent',
      });

      // Add message from second agent
      await storage.insertMessage(session.id, {
        timestamp: '2026-03-01T10:02:00.000Z',
        from: 'backend-agent',
        isHuman: false,
        content: 'Implementing the architecture',
      });

      // Verify session has both agents
      const updated = await storage.getSession(session.id);
      expect(updated?.agentIds).toContain('architect-agent');
      expect(updated?.agentIds).toContain('backend-agent');

      // Verify all messages are there
      const messages = await storage.getSessionMessages(session.id);
      expect(messages).toHaveLength(3);

      // Filter messages by agent
      const architectMessages = await storage.queryMessages({
        sessionId: session.id,
        fromId: 'architect-agent',
      });
      expect(architectMessages).toHaveLength(2);

      const backendMessages = await storage.queryMessages({
        sessionId: session.id,
        fromId: 'backend-agent',
      });
      expect(backendMessages).toHaveLength(1);
    });
  });
});
