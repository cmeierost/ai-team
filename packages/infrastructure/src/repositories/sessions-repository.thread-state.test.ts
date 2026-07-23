import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteBackend } from '../storage/sqlite/sqlite-storage.js';
import { SessionsRepository } from './sessions-repository.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(
    workspaces.splice(0).map((workspace) => fs.rm(workspace, { recursive: true, force: true }))
  );
});

describe('SessionsRepository thread state persistence', () => {
  it('migrates and round-trips the root thread cursor and navigation stack', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-thread-state-'));
    workspaces.push(workspace);
    const backend = new SqliteBackend(workspace);
    const repository = new SessionsRepository(
      backend.ensureReadyAsync,
      backend.getDb,
      {} as any
    );
    const now = new Date().toISOString();

    try {
      const root = await repository.createSession({
        agentIds: ['michael'],
        agentId: 'michael',
        developerId: 'clemens',
        startedAt: now,
        lastActivityAt: now,
        artifacts: [],
        allowedFiles: [],
      });

      await repository.updateSession(root.id, {
        activeSessionId: 'session-emily',
        threadNavigationStack: [
          {
            agentId: 'michael',
            agentName: 'Michael Brown',
            sessionId: root.id,
          },
        ],
        threadLastActiveAt: '2026-07-23T13:00:00.000Z',
      });

      await expect(repository.getSession(root.id)).resolves.toMatchObject({
        activeSessionId: 'session-emily',
        threadNavigationStack: [
          {
            agentId: 'michael',
            agentName: 'Michael Brown',
            sessionId: root.id,
          },
        ],
        threadLastActiveAt: '2026-07-23T13:00:00.000Z',
      });
    } finally {
      await backend.close();
    }
  });
});
