import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SqliteBackend,
  MessagesRepository,
  SessionsRepository,
  NotesRepository,
} from '@ai-team/infrastructure';
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
  let backend: SqliteBackend;
  let messages: MessagesRepository;
  let sessions: SessionsRepository;
  let notes: NotesRepository;
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await createTempWorkspace();
    backend = new SqliteBackend(workspaceRoot);
    await backend.migrate();
    notes = new NotesRepository(workspaceRoot, backend.ensureReadyAsync, backend.getDb);
    messages = new MessagesRepository(backend.ensureReadyAsync, backend.getDb);
    sessions = new SessionsRepository(backend.ensureReadyAsync, backend.getDb, notes);
  });

  afterEach(async () => {
    await backend.close();
  });

  describe('Sessions', () => {
    it('creates and retrieves a session', async () => {
      const session = await sessions.createSession({
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

      const retrieved = await sessions.getSession(session.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(session.id);
      expect(retrieved?.agentIds).toEqual(['architect-agent']);
    });

    it('lists sessions with filtering', async () => {
      // Create multiple sessions
      const session1 = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      await sessions.createSession({
        agentIds: ['backend-agent'],
        agentId: 'backend-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-2',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      // List all sessions
      const allSessions = await sessions.listSessions();
      expect(allSessions).toHaveLength(3);

      // Filter by agent
      const architectSessions = await sessions.listSessions({ agentId: 'architect-agent' });
      expect(architectSessions).toHaveLength(2);

      // Filter by developer
      const dev1Sessions = await sessions.listSessions({ developerId: 'developer-1' });
      expect(dev1Sessions).toHaveLength(2);

      // Filter by both
      const filtered = await sessions.listSessions({
        agentId: 'architect-agent',
        developerId: 'developer-1',
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe(session1.id);
    });

    it('updates session metadata', async () => {
      const session = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      await sessions.updateSession(session.id, {
        title: 'Authentication Refactor',
        notes: 'Planning JWT implementation',
        artifacts: ['brief-auth-design'],
        allowedFiles: ['src/auth/**'],
      });

      const updated = await sessions.getSession(session.id);
      expect(updated?.title).toBe('Authentication Refactor');
      expect(updated?.notes).toBe('Planning JWT implementation');
      expect(updated?.artifacts).toEqual(['brief-auth-design']);
      expect(updated?.allowedFiles).toEqual(['src/auth/**']);
    });

    it('deletes a session and its messages', async () => {
      const session = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      // Add a message
      await messages.insertMessage(session.id, {
        timestamp: new Date().toISOString(),
        from: 'developer-1',
        isHuman: true,
        content: 'Hello',
      });

      // Delete session
      const deleted = await sessions.deleteSession(session.id);
      expect(deleted).toBe(true);

      // Verify session is gone
      const retrieved = await sessions.getSession(session.id);
      expect(retrieved).toBeNull();

      // Verify messages are gone too
      const messages = await messages.getSessionMessages(session.id);
      expect(messages).toHaveLength(0);
    });

    it('adds and removes agents from session', async () => {
      const session = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      // Add another agent
      await sessions.addSessionAgent(session.id, 'backend-agent');

      const updated = await sessions.getSession(session.id);
      expect(updated?.agentIds).toContain('architect-agent');
      expect(updated?.agentIds).toContain('backend-agent');

      // Remove an agent
      await sessions.removeSessionAgent(session.id, 'architect-agent');

      const final = await sessions.getSession(session.id);
      expect(final?.agentIds).not.toContain('architect-agent');
      expect(final?.agentIds).toContain('backend-agent');
    });
  });

  describe('Messages', () => {
    let sessionId: string;

    beforeEach(async () => {
      const session = await sessions.createSession({
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

      const result = await messages.insertMessage(sessionId, message);
      expect(result.messageId).toBeDefined();
      expect(result.timestamp).toBeDefined();

      const messages = await messages.getSessionMessages(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('How do I implement authentication?');
      expect(messages[0].from).toBe('developer-1');
      expect(messages[0].isHuman).toBe(true);
    });

    it('stores message id and hiddenFromLlm flag and allows toggling by id', async () => {
      const inserted = await messages.insertMessage(sessionId, {
        timestamp: new Date().toISOString(),
        from: 'architect-agent',
        isHuman: false,
        content: 'Temporary context row',
        hiddenFromLlm: true,
      });

      const all = await messages.queryMessages({ sessionId });
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(inserted.messageId);
      expect(all[0].hiddenFromLlm).toBe(true);

      const byId = await messages.getMessageById(Number(inserted.messageId));
      expect(byId?.id).toBe(inserted.messageId);
      expect(byId?.hiddenFromLlm).toBe(true);

      const updated = await messages.setMessageHiddenFromLlm(Number(inserted.messageId), false);
      expect(updated).toBe(true);

      const afterToggle = await messages.getMessageById(Number(inserted.messageId));
      expect(afterToggle?.hiddenFromLlm).toBeUndefined();
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
            resultLlm: 'File: src/auth/login.ts\nScope: full-file\n\nfile content',
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

      await messages.insertMessage(sessionId, message);

      const messages = await messages.getSessionMessages(sessionId);
      expect(messages).toHaveLength(1);
      expect(messages[0].context).toHaveLength(2);
      expect(messages[0].context).toContain('src/auth/login.ts');
      expect(messages[0].context).toContain('src/auth/jwt.ts');
      expect(messages[0].tool_calls).toHaveLength(1);
      expect(messages[0].tool_calls![0].tool).toBe('fs_read');
      expect(messages[0].tool_calls![0].resultLlm).toBe(
        'File: src/auth/login.ts\nScope: full-file\n\nfile content'
      );
      expect(messages[0].suggestions).toHaveLength(1);
      expect(messages[0].suggestions![0].file).toBe('src/auth/jwt.ts');
    });

    it('updates the readable result_llm text for a stored tool call', async () => {
      await messages.insertMessage(sessionId, {
        timestamp: new Date().toISOString(),
        from: 'architect-agent',
        isHuman: false,
        content: '[tool:fs_read] original',
        tool_calls: [
          {
            tool: 'fs_read',
            params: { filePath: 'src/example.ts' },
            result: { path: 'src/example.ts', content: 'const x = 1;' },
            resultLlm: 'File: src/example.ts\nScope: full-file\n\nconst x = 1;',
          },
        ],
      });

      const initialMessages = await messages.getSessionMessages(sessionId);
      const toolCallId = initialMessages[0].tool_calls?.[0]?.id;
      expect(toolCallId).toBeDefined();

      await messages.updateToolCallLlmResult(
        toolCallId!,
        'File: src/example.ts\nScope: full-file\n\nconst x = 2;'
      );

      const updatedMessages = await messages.getSessionMessages(sessionId);
      expect(updatedMessages[0].tool_calls?.[0]?.resultLlm).toBe(
        'File: src/example.ts\nScope: full-file\n\nconst x = 2;'
      );
    });

    it('maintains message order by timestamp', async () => {
      const timestamps = [
        '2026-03-01T10:00:00.000Z',
        '2026-03-01T10:01:00.000Z',
        '2026-03-01T10:02:00.000Z',
      ];

      for (const timestamp of timestamps) {
        await messages.insertMessage(sessionId, {
          timestamp,
          from: 'developer-1',
          isHuman: true,
          content: `Message at ${timestamp}`,
        });
      }

      const messages = await messages.getSessionMessages(sessionId);
      expect(messages).toHaveLength(3);
      expect(messages[0].timestamp).toBe(timestamps[0]);
      expect(messages[1].timestamp).toBe(timestamps[1]);
      expect(messages[2].timestamp).toBe(timestamps[2]);
    });

    it('archives and unarchives messages', async () => {
      const timestamp = new Date().toISOString();
      await messages.insertMessage(sessionId, {
        timestamp,
        from: 'developer-1',
        isHuman: true,
        content: 'Test message',
      });

      // Get all messages (including archived)
      let messages = await messages.getSessionMessages(sessionId, true);
      expect(messages[0].archived).toBeUndefined();

      // Archive the message
      await messages.archiveMessage(sessionId, timestamp);

      // Check archived flag
      messages = await messages.getSessionMessages(sessionId, true);
      expect(messages[0].archived).toBe(true);

      // Default excludes archived
      messages = await messages.getSessionMessages(sessionId);
      expect(messages).toHaveLength(0);
    });

    it('deletes messages', async () => {
      const timestamp = new Date().toISOString();
      await messages.insertMessage(sessionId, {
        timestamp,
        from: 'developer-1',
        isHuman: true,
        content: 'Test message',
      });

      let messages = await messages.getSessionMessages(sessionId);
      expect(messages).toHaveLength(1);

      const deleted = await messages.deleteMessage(sessionId, timestamp);
      expect(deleted).toBe(true);

      messages = await messages.getSessionMessages(sessionId);
      expect(messages).toHaveLength(0);
    });

    it('filters messages by sender', async () => {
      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:00:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'Human message',
      });

      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'Agent message',
      });

      const humanMessages = await messages.queryMessages({
        sessionId,
        isHuman: true,
      });
      expect(humanMessages).toHaveLength(1);
      expect(humanMessages[0].from).toBe('developer-1');

      const agentMessages = await messages.queryMessages({
        sessionId,
        fromId: 'architect-agent',
      });
      expect(agentMessages).toHaveLength(1);
      expect(agentMessages[0].from).toBe('architect-agent');
    });

    it('searches messages by content', async () => {
      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:00:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'How do I implement JWT authentication?',
      });

      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'For authentication, use the jsonwebtoken library.',
      });

      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:02:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'What about error handling?',
      });

      const results = await messages.searchMessages('authentication', sessionId);
      expect(results).toHaveLength(2);
      expect(results.some((m) => m.content.includes('JWT'))).toBe(true);
      expect(results.some((m) => m.content.includes('jsonwebtoken'))).toBe(true);
    });

    it('searches messages with FTS5 boolean operators', async () => {
      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:00:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'How do I implement JWT authentication?',
      });

      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'Use the jsonwebtoken library for authentication.',
      });

      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:02:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'What about JWT validation and error handling?',
      });

      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:03:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'Use OAuth2 for API authentication.',
      });

      // Boolean AND: both terms must be present
      const andResults = await messages.searchMessages('JWT AND validation', sessionId);
      expect(andResults).toHaveLength(1);
      expect(andResults[0].content).toContain('validation');

      // Boolean OR: either term can be present
      const orResults = await messages.searchMessages('JWT OR OAuth2', sessionId);
      expect(orResults.length).toBeGreaterThanOrEqual(3);

      // Boolean NOT: exclude term
      const notResults = await messages.searchMessages('authentication NOT OAuth2', sessionId);
      expect(notResults.every((m) => !m.content.includes('OAuth2'))).toBe(true);
      expect(notResults.length).toBeGreaterThan(0);
    });

    it('searches messages with phrase queries', async () => {
      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:00:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'I need help with error handling strategies.',
      });

      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'For error handling, use try-catch blocks.',
      });

      await messages.insertMessage(sessionId, {
        timestamp: '2026-03-01T10:02:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'Errors occur during runtime in handling module.',
      });

      // Phrase query: exact phrase match
      const results = await messages.searchMessages('"error handling"', sessionId);
      expect(results).toHaveLength(2);
      expect(results.every((m) => m.content.toLowerCase().includes('error handling'))).toBe(true);
    });
  });

  describe('Notes', () => {
    it('creates and retrieves notes', async () => {
      const note = await notes.createNote({
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

      const retrieved = await notes.getNote(note.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe(note.content);
      expect(retrieved?.tags).toEqual(['authentication', 'jwt', 'refactoring']);
    });

    it('persists shared session visibility when creating notes', async () => {
      const ownerSession = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const sharedSession = await sessions.createSession({
        agentIds: ['backend-agent'],
        agentId: 'backend-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const note = await notes.createNote({
        agentId: 'architect-agent',
        sessionId: ownerSession.id,
        sharedSessionIds: [sharedSession.id],
        title: 'Shared architecture note',
        content: 'This note should be visible to another session.',
        hiddenFromLlm: true,
        showOnDashboard: true,
      });

      expect(note.sharedSessionIds).toEqual([sharedSession.id]);
      expect(note.hiddenFromLlm).toBe(true);
      expect(note.showOnDashboard).toBe(true);

      const retrieved = await notes.getNote(note.id);
      expect(retrieved?.sharedSessionIds).toEqual([sharedSession.id]);
      expect(retrieved?.hiddenFromLlm).toBe(true);
      expect(retrieved?.showOnDashboard).toBe(true);

      const sessionNotes = await notes.listSessionNotes(ownerSession.id);
      expect(sessionNotes[0]?.sharedSessionIds).toEqual([sharedSession.id]);
    });

    it('reports session delete impact and blocks deleting unshared owner notes', async () => {
      const ownerSession = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const sharedSession = await sessions.createSession({
        agentIds: ['backend-agent'],
        agentId: 'backend-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const sharedNote = await notes.createNote({
        agentId: 'architect-agent',
        sessionId: ownerSession.id,
        sharedSessionIds: [sharedSession.id],
        title: 'Shared note',
        content: 'Reassign me when the owner session is deleted.',
      });

      const unsharedNote = await notes.createNote({
        agentId: 'architect-agent',
        sessionId: ownerSession.id,
        title: 'Private note',
        content: 'Deleting the owner session should warn first.',
      });

      const impact = await sessions.getSessionDeleteImpact(ownerSession.id);
      expect(impact.transferableNotes).toEqual([
        {
          noteId: sharedNote.id,
          title: 'Shared note',
          targetSessionId: sharedSession.id,
          remainingSharedSessionIds: [],
        },
      ]);
      expect(impact.unsharedOwnedNotes).toEqual([
        {
          noteId: unsharedNote.id,
          title: 'Private note',
        },
      ]);

      await expect(sessions.deleteSession(ownerSession.id)).rejects.toThrow(/unshared note/);
      expect(await sessions.getSession(ownerSession.id)).not.toBeNull();
      expect(await notes.getNote(sharedNote.id)).not.toBeNull();
      expect(await notes.getNote(unsharedNote.id)).not.toBeNull();
    });

    it('transfers a shared note to the next owner when deleting the owner session', async () => {
      const ownerSession = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const firstSharedSession = await sessions.createSession({
        agentIds: ['backend-agent'],
        agentId: 'backend-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const secondSharedSession = await sessions.createSession({
        agentIds: ['qa-agent'],
        agentId: 'qa-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const note = await notes.createNote({
        agentId: 'architect-agent',
        sessionId: ownerSession.id,
        sharedSessionIds: [firstSharedSession.id, secondSharedSession.id],
        title: 'Transfer ownership note',
        content: 'Move me to the next shared session.',
      });

      const deleted = await sessions.deleteSession(ownerSession.id);
      expect(deleted).toBe(true);
      expect(await sessions.getSession(ownerSession.id)).toBeNull();

      const moved = await notes.getNote(note.id);
      expect(moved?.sessionId).toBe(firstSharedSession.id);
      expect(moved?.sharedSessionIds).toEqual([secondSharedSession.id]);

      const firstSharedNotes = await notes.listSessionNotes(firstSharedSession.id);
      expect(firstSharedNotes.map((entry) => entry.id)).toContain(note.id);
    });

    it('lists notes pinned to the dashboard', async () => {
      const pinned = await notes.createNote({
        agentId: 'architect-agent',
        sessionId: 'session-a',
        title: 'Pinned for developer',
        content: 'Show this on the start page.',
        showOnDashboard: true,
      });

      await notes.createNote({
        agentId: 'backend-agent',
        sessionId: 'session-b',
        title: 'Regular note',
        content: 'Do not show this on the dashboard.',
        showOnDashboard: false,
      });

      const dashboardNotes = await notes.listDashboardNotes();
      expect(dashboardNotes.map((note) => note.id)).toEqual([pinned.id]);
      expect(dashboardNotes[0]?.showOnDashboard).toBe(true);
    });

    it('lists notes by agent', async () => {
      await notes.createNote({
        agentId: 'architect-agent',
        content: 'Note 1 for architect',
      });

      await notes.createNote({
        agentId: 'architect-agent',
        content: 'Note 2 for architect',
      });

      await notes.createNote({
        agentId: 'backend-agent',
        content: 'Note for backend',
      });

      const architectNotes = await notes.listAgentNotes('architect-agent');
      expect(architectNotes).toHaveLength(2);

      const backendNotes = await notes.listAgentNotes('backend-agent');
      expect(backendNotes).toHaveLength(1);
    });

    it('updates notes', async () => {
      const note = await notes.createNote({
        agentId: 'architect-agent',
        title: 'Initial Title',
        content: 'Initial content',
        tags: ['tag1'],
      });

      await new Promise((r) => setTimeout(r, 5));
      await notes.updateNote(note.id, {
        title: 'Updated Title',
        content: 'Updated content with more details',
        tags: ['tag1', 'tag2', 'updated'],
      });

      const updated = await notes.getNote(note.id);
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.content).toBe('Updated content with more details');
      expect(updated?.tags).toEqual(['tag1', 'tag2', 'updated']);
      expect(updated?.updatedAt).not.toBe(note.updatedAt);
    });

    it('lists session notes and persists attachments', async () => {
      const session = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const note = await notes.createNote({
        agentId: 'architect-agent',
        sessionId: session.id,
        title: 'Session upload',
        content: 'Attached a sketch for the session.',
        attachment: {
          fileName: 'architecture-sketch.md',
          contentBase64: Buffer.from('# sketch').toString('base64'),
          contentType: 'text/markdown',
          description: 'Initial architecture sketch',
        },
      });

      const sessionNotes = await notes.listSessionNotes(session.id);
      expect(sessionNotes).toHaveLength(1);
      expect(sessionNotes[0].id).toBe(note.id);
      expect(sessionNotes[0].attachment?.fileName).toBe('architecture-sketch.md');
      expect(sessionNotes[0].attachment?.description).toBe('Initial architecture sketch');

      const attachmentPath = path.join(workspaceRoot, sessionNotes[0].attachment!.filePath);
      const attachmentContent = await fs.readFile(attachmentPath, 'utf-8');
      expect(attachmentContent).toBe('# sketch');
    });

    it('replaces and removes note attachments on update', async () => {
      const note = await notes.createNote({
        agentId: 'architect-agent',
        content: 'Attachment lifecycle',
        attachment: {
          fileName: 'old.txt',
          contentBase64: Buffer.from('old-content').toString('base64'),
        },
      });

      const originalAttachmentPath = path.join(workspaceRoot, note.attachment!.filePath);

      await notes.updateNote(note.id, {
        attachment: {
          fileName: 'new.txt',
          contentBase64: Buffer.from('new-content').toString('base64'),
        },
      });

      const replaced = await notes.getNote(note.id);
      expect(replaced?.attachment?.fileName).toBe('new.txt');
      await expect(fs.access(originalAttachmentPath)).rejects.toThrow();

      await notes.updateNote(note.id, { attachment: null });
      const withoutAttachment = await notes.getNote(note.id);
      expect(withoutAttachment?.attachment).toBeUndefined();
    });

    it('deletes notes', async () => {
      const note = await notes.createNote({
        agentId: 'architect-agent',
        content: 'Test note',
      });

      const deleted = await notes.deleteNote(note.id);
      expect(deleted).toBe(true);

      const retrieved = await notes.getNote(note.id);
      expect(retrieved).toBeNull();
    });

    it('searches notes by content', async () => {
      await notes.createNote({
        agentId: 'architect-agent',
        title: 'JWT Authentication',
        content: 'Implement JWT-based authentication system',
        tags: ['security'],
      });

      await notes.createNote({
        agentId: 'architect-agent',
        title: 'Database Migration',
        content: 'Plan migration from MySQL to PostgreSQL',
        tags: ['database'],
      });

      await notes.createNote({
        agentId: 'backend-agent',
        title: 'API Authentication',
        content: 'Add OAuth2 authentication to REST API',
        tags: ['api', 'security'],
      });

      // Search all notes
      const allResults = await notes.searchNotes('authentication');
      expect(allResults).toHaveLength(2);

      // Search notes for specific agent
      const architectResults = await notes.searchNotes('authentication', 'architect-agent');
      expect(architectResults).toHaveLength(1);
      expect(architectResults[0].title).toBe('JWT Authentication');
    });

    it('searches notes with FTS5 features', async () => {
      await notes.createNote({
        agentId: 'developer-1',
        title: 'API Testing Guide',
        content: 'We need to test all API endpoints and validate responses.',
        tags: ['testing', 'api'],
      });

      await notes.createNote({
        agentId: 'developer-1',
        title: 'Unit Test Configuration',
        content:
          'Configure the test runner to execute unit tests automatically. Mock API responses for testing.',
        tags: ['testing', 'config'],
      });

      await notes.createNote({
        agentId: 'developer-1',
        title: 'Deployment Guide',
        content: 'Deploy the application to production after running tests.',
        tags: ['deployment', 'testing'],
      });

      // FTS5 word matching: "test" should match all notes containing the word "test" (case insensitive)
      const testResults = await notes.searchNotes('test', 'developer-1');
      expect(testResults.length).toBeGreaterThanOrEqual(2); // Found in title and content

      // FTS5 word matching: "testing" should match notes with that exact word in title or content
      const testingResults = await notes.searchNotes('testing', 'developer-1');
      expect(testingResults.length).toBeGreaterThanOrEqual(1); // Found in title (note: tags are not indexed)

      // FTS5 word matching: "API" should match by title
      const apiResults = await notes.searchNotes('API', 'developer-1');
      expect(apiResults.length).toBeGreaterThanOrEqual(2); // Found in title and content
    });

    it('searches notes with FTS5 operators', async () => {
      await notes.createNote({
        agentId: 'developer-1',
        title: 'API Security Best Practices',
        content: 'Implement HTTPS and JWT authentication for API endpoints.',
        tags: ['security', 'api'],
      });

      await notes.createNote({
        agentId: 'developer-1',
        title: 'Database Security',
        content: 'Use encryption for sensitive data in the database.',
        tags: ['security', 'database'],
      });

      await notes.createNote({
        agentId: 'developer-1',
        title: 'API Rate Limiting',
        content: 'Configure rate limiting for public API endpoints.',
        tags: ['api', 'performance'],
      });

      // Boolean AND
      const andResults = await notes.searchNotes('API AND security', 'developer-1');
      expect(andResults).toHaveLength(1);
      expect(andResults[0].title).toContain('API Security');

      // Boolean OR
      const orResults = await notes.searchNotes('authentication OR encryption', 'developer-1');
      expect(orResults).toHaveLength(2);

      // Phrase query
      const phraseResults = await notes.searchNotes('"rate limiting"', 'developer-1');
      expect(phraseResults).toHaveLength(1);
      expect(phraseResults[0].content).toContain('rate limiting');
    });

    it('creates and removes message-session links', async () => {
      const session = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const insertResult = await messages.insertMessage(session.id, {
        timestamp: new Date().toISOString(),
        from: 'developer-1',
        isHuman: true,
        content: 'Please keep this message handy.',
      });
      const messageId = Number(insertResult.messageId);

      const link = await messages.createMessageSessionLink(messageId, session.id);
      expect(link.messageId).toBe(messageId);

      const links = await messages.listMessageSessionLinks(session.id);
      expect(links).toHaveLength(1);
      expect(links[0].messageId).toBe(messageId);

      const deleted = await messages.deleteMessageSessionLink(messageId, session.id);
      expect(deleted).toBe(true);
      expect(await messages.listMessageSessionLinks(session.id)).toHaveLength(0);
    });
  });

  describe('Statistics', () => {
    it('returns accurate storage statistics', async () => {
      // Create sessions
      const session1 = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      const session2 = await sessions.createSession({
        agentIds: ['backend-agent'],
        agentId: 'backend-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      // Add messages
      await messages.insertMessage(session1.id, {
        timestamp: new Date().toISOString(),
        from: 'developer-1',
        isHuman: true,
        content: 'Message 1',
      });

      await messages.insertMessage(session1.id, {
        timestamp: new Date().toISOString(),
        from: 'architect-agent',
        isHuman: false,
        content: 'Message 2',
      });

      await messages.insertMessage(session2.id, {
        timestamp: new Date().toISOString(),
        from: 'developer-1',
        isHuman: true,
        content: 'Message 3',
      });

      const stats = await backend.getStats();
      expect(stats.totalSessions).toBe(2);
      expect(stats.totalMessages).toBe(3);
      expect(stats.schemaVersion).toBe(1);
      expect(stats.storageSize).toBeGreaterThan(0);
    });

    it('stores and retrieves message importance field', async () => {
      const session = await sessions.createSession({
        agentIds: ['agent-1'],
        agentId: 'agent-1',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      await messages.insertMessage(session.id, {
        timestamp: new Date().toISOString(),
        from: 'agent-1',
        content: 'Hi there! How can I help?',
        importance: 'low',
      });

      await messages.insertMessage(session.id, {
        timestamp: new Date().toISOString(),
        from: 'developer-1',
        isHuman: true,
        content: 'Please help me with X.',
        // importance omitted → undefined (normal)
      });

      const retrievedMessages = await messages.getSessionMessages(session.id);
      expect(retrievedMessages).toHaveLength(2);
      expect(retrievedMessages[0].importance).toBe('low');
      expect(retrievedMessages[1].importance).toBeUndefined();
    });
  });

  describe('Complex Operations', () => {
    it('handles session merge scenario', async () => {
      // Create two sessions
      const session1 = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: '2026-03-01T10:00:00.000Z',
        lastActivityAt: '2026-03-01T10:00:00.000Z',
        artifacts: [],
        allowedFiles: [],
      });

      const session2 = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: '2026-03-01T11:00:00.000Z',
        lastActivityAt: '2026-03-01T11:00:00.000Z',
        artifacts: [],
        allowedFiles: [],
      });

      // Add messages to both sessions
      await messages.insertMessage(session1.id, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'Session 1 message',
      });

      await messages.insertMessage(session2.id, {
        timestamp: '2026-03-01T11:01:00.000Z',
        from: 'developer-1',
        isHuman: true,
        content: 'Session 2 message',
      });

      // Merge session2 messages into session1
      const session2Messages = await messages.getSessionMessages(session2.id);
      for (const msg of session2Messages) {
        await messages.insertMessage(session1.id, msg);
      }

      // Update session1 metadata
      await sessions.updateSession(session1.id, {
        lastActivityAt: '2026-03-01T11:01:00.000Z',
        mergedFromSessionIds: [session2.id],
      });

      // Delete session2
      await sessions.deleteSession(session2.id);

      // Verify
      const session1Messages = await messages.getSessionMessages(session1.id);
      expect(session1Messages).toHaveLength(2);

      const session2Exists = await sessions.getSession(session2.id);
      expect(session2Exists).toBeNull();

      const merged = await sessions.getSession(session1.id);
      expect(merged?.mergedFromSessionIds).toBeDefined();
      expect(merged?.mergedFromSessionIds).toContain(session2.id);
    });

    it('handles multi-agent session workflow', async () => {
      // Create session with one agent
      const session = await sessions.createSession({
        agentIds: ['architect-agent'],
        agentId: 'architect-agent',
        developerId: 'developer-1',
        startedAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        artifacts: [],
        allowedFiles: [],
      });

      // Add messages from first agent
      await messages.insertMessage(session.id, {
        timestamp: '2026-03-01T10:00:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'Architecture plan ready',
      });

      // Add second agent to session
      await sessions.addSessionAgent(session.id, 'backend-agent');

      // Add handoff message
      await messages.insertMessage(session.id, {
        timestamp: '2026-03-01T10:01:00.000Z',
        from: 'architect-agent',
        to: 'backend-agent',
        isHuman: false,
        content: 'Handing off to backend agent',
        handoffType: 'agent-briefing',
        targetAgentId: 'backend-agent',
      });

      // Add message from second agent
      await messages.insertMessage(session.id, {
        timestamp: '2026-03-01T10:02:00.000Z',
        from: 'backend-agent',
        isHuman: false,
        content: 'Implementing the architecture',
      });

      // Verify session has both agents
      const updated = await sessions.getSession(session.id);
      expect(updated?.agentIds).toContain('architect-agent');
      expect(updated?.agentIds).toContain('backend-agent');

      // Verify all messages are there
      const allMessages = await messages.getSessionMessages(session.id);
      expect(allMessages).toHaveLength(3);

      // Filter messages by agent
      const architectMessages = await messages.queryMessages({
        sessionId: session.id,
        fromId: 'architect-agent',
      });
      expect(architectMessages).toHaveLength(2);

      const backendMessages = await messages.queryMessages({
        sessionId: session.id,
        fromId: 'backend-agent',
      });
      expect(backendMessages).toHaveLength(1);
    });
  });
});

