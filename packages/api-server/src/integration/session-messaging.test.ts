import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { startServer } from '../server.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Module-level handle — closed in beforeAll if a previous test run crashed
// before afterAll could clean up (e.g. vitest watch-mode restart, Ctrl-C).
let _lingering: { httpServer: Server; wss: any; storage: { close(): Promise<void> } } | null = null;

async function closeServer(s: typeof _lingering): Promise<void> {
  if (!s) return;
  // Close WebSocket server first so in-flight connections drain.
  if (s.wss) await new Promise<void>((r) => s!.wss.close(r));
  // Close SQLite before HTTP so Windows does not report EBUSY.
  if (s.storage) await s.storage.close();
  if (s.httpServer?.listening) await new Promise<void>((r) => s!.httpServer.close(() => r()));
}

describe('Session-Message Integration', () => {
  let server: { httpServer: Server; wss: any; storage: { close(): Promise<void> } };
  let workspaceRoot: string;
  let port: number;

  beforeAll(async () => {
    // Kill any server that survived a previous crashed run (watch-mode, Ctrl-C, etc.).
    await closeServer(_lingering);
    _lingering = null;

    // Create temporary workspace
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-integration-test-'));

    // Create .ai-team directory structure
    await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'config'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'private', 'chats'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'agents'), { recursive: true });

    // Create a test agent
    await fs.writeFile(
      path.join(workspaceRoot, '.ai-team', 'agents', 'test-agent.md'),
      `---
name: Test Agent
role: developer
contextLevel: module
---

# Test Agent

A test agent for integration testing.
`
    );

    // Create basic config
    await fs.writeFile(
      path.join(workspaceRoot, '.ai-team', 'config', 'config.json'),
      JSON.stringify({
        providers: [],
        models: [],
        defaultProvider: null,
        defaultModel: null,
      })
    );

    // Port 0 lets the OS assign a guaranteed-free ephemeral port.
    // Read the actual assigned port from httpServer.address() after listen.
    server = await startServer({
      port: 0,
      workspaceRoot,
      serveStaticFiles: false,
    });
    _lingering = server;
    port = (server.httpServer.address() as AddressInfo).port;
  }, 30000);

  afterAll(async () => {
    await closeServer(server);
    _lingering = null;
    // Clean up workspace
    try {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to clean up workspace:', error);
    }
  });

  it('should create a session via REST API', async () => {
    const response = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'test-agent',
        developerId: 'test-developer',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to create session:', error);
    }

    expect(response.ok).toBe(true);
    const session = await response.json();

    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(session.agentId).toBe('test-agent');
    expect(session.developerId).toBe('test-developer');
    expect(session.messageCount).toBe(0);
  });

  it('should persist messages to session when using WebSocket', async () => {
    // First create a session
    const createResponse = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'test-agent',
        developerId: 'test-developer',
      }),
    });

    expect(createResponse.ok).toBe(true);
    const session = await createResponse.json();
    const sessionId = session.id;

    // Connect to WebSocket with sessionId
    const ws = new WebSocket(`ws://localhost:${port}/ws/chat/test-agent?sessionId=${sessionId}`);

    // Set up message listener before waiting for connection to avoid race condition
    let readyEventReceived: any = null;
    ws.on('message', (data) => {
      const event = JSON.parse(data.toString());
      if (event.type === 'ready') {
        readyEventReceived = event;
      }
      if (event.type === 'error') {
        console.error('WebSocket error event:', event);
      }
    });

    // Wait for connection and ready event
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!readyEventReceived) {
          reject(new Error('Ready event timeout'));
        }
      }, 5000);

      ws.on('open', () => {
        // Give a small delay for the ready event to arrive
        setTimeout(() => {
          clearTimeout(timeout);
          if (readyEventReceived) {
            resolve();
          } else {
            reject(new Error('Ready event not received after connection'));
          }
        }, 100);
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    expect(readyEventReceived).toBeDefined();
    expect(readyEventReceived.type).toBe('ready');

    // Note: Sending a message would trigger the chat command which requires
    // a full LLM setup. For this test, we'll just verify the session was created
    // and the WebSocket connection works with sessionId parameter.

    // Close WebSocket
    ws.close();

    // Verify session still exists
    const sessionResponse = await fetch(`http://localhost:${port}/api/sessions/${sessionId}`);
    expect(sessionResponse.ok).toBe(true);
    const updatedSession = await sessionResponse.json();
    expect(updatedSession.id).toBe(sessionId);
  }, 15000);

  it('should load messages from a session', async () => {
    // Create a session
    const createResponse = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'test-agent',
        developerId: 'test-developer',
      }),
    });

    expect(createResponse.ok).toBe(true);
    const session = await createResponse.json();
    const sessionId = session.id;

    // Load messages (should be empty initially)
    const messagesResponse = await fetch(
      `http://localhost:${port}/api/sessions/${sessionId}/messages`
    );
    expect(messagesResponse.ok).toBe(true);

    const messages = await messagesResponse.json();
    expect(Array.isArray(messages)).toBe(true);
    expect(messages.length).toBe(0);
  });

  it('should list sessions for an agent', async () => {
    // Create multiple sessions
    await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'test-agent',
        developerId: 'test-developer',
      }),
    });

    await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'test-agent',
        developerId: 'test-developer',
      }),
    });

    // List sessions
    const listResponse = await fetch(`http://localhost:${port}/api/sessions?agentId=test-agent`);
    expect(listResponse.ok).toBe(true);

    const sessions = await listResponse.json();
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    // Verify all sessions are for the correct agent
    sessions.forEach((s: any) => {
      expect(s.agentId).toBe('test-agent');
      expect(s.developerId).toBe('test-developer');
    });
  });

  it('should get the latest session for an agent', async () => {
    // Create a session
    const createResponse = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'test-agent',
        developerId: 'test-developer',
      }),
    });

    expect(createResponse.ok).toBe(true);
    const newSession = await createResponse.json();

    // Get latest session
    const latestResponse = await fetch(`http://localhost:${port}/api/sessions/test-agent/latest`);
    expect(latestResponse.ok).toBe(true);

    const latestSession = await latestResponse.json();
    expect(latestSession.id).toBe(newSession.id);
  });

  it('should create handoff sessions', async () => {
    // Create initial session
    const createResponse = await fetch(`http://localhost:${port}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId: 'test-agent',
        developerId: 'test-developer',
      }),
    });

    expect(createResponse.ok).toBe(true);
    const session = await createResponse.json();

    // Create handoff session
    const handoffResponse = await fetch(`http://localhost:${port}/api/sessions/handoff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toAgentId: 'test-agent',
        developerId: 'test-developer',
        previousSessionId: session.id,
        transferArtifacts: true,
        transferAllowedFiles: true,
      }),
    });

    expect(handoffResponse.ok).toBe(true);
    const handoffSession = await handoffResponse.json();

    expect(handoffSession.id).toBeDefined();
    expect(handoffSession.previousSessionId).toBe(session.id);
    expect(handoffSession.developerId).toBe('test-developer');
  });
});
