import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqliteBackend } from '../storage/sqlite/sqlite-storage.js';
import { WorkflowRunRepository } from './workflow-run-repository.js';

describe('WorkflowRunRepository', () => {
  const backends: SqliteBackend[] = [];
  const workspaces: string[] = [];

  afterEach(async () => {
    await Promise.all(backends.splice(0).map((backend) => backend.close()));
    await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
  });

  it('persists the latest ordered actor snapshot and resolves the active session', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'ai-team-workflow-runs-'));
    workspaces.push(workspace);
    const backend = new SqliteBackend(workspace);
    backends.push(backend);
    const repository = new WorkflowRunRepository(backend.ensureReadyAsync, backend.getDb);

    await repository.save({
      id: 'run-1',
      definitionId: 'onboarding',
      definitionVersion: '1',
      status: 'active',
      input: { developerId: 'dev-1' },
      snapshot: { value: 'definingBusiness', children: {} },
      snapshotSequence: 1,
      rootSessionId: 'root-session',
      activeSessionId: 'ceo-session',
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    });
    await repository.save({
      id: 'run-1',
      definitionId: 'onboarding',
      definitionVersion: '1',
      status: 'active',
      input: { developerId: 'dev-1' },
      snapshot: { value: 'selectingHr', children: {} },
      snapshotSequence: 2,
      rootSessionId: 'root-session',
      activeSessionId: 'hr-session',
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:01:00.000Z',
    });

    await expect(repository.get('run-1')).resolves.toMatchObject({
      snapshot: { value: 'selectingHr' },
      snapshotSequence: 2,
      activeSessionId: 'hr-session',
    });
    await expect(repository.findActiveBySession('hr-session')).resolves.toMatchObject({
      id: 'run-1',
      snapshotSequence: 2,
    });
    await expect(repository.findActiveBySession('ceo-session')).resolves.toBeNull();
  });
});
