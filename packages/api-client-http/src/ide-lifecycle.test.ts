import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpAiTeamClient } from './index.js';

describe('HttpAiTeamClient IDE lifecycle methods', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('calls open-diff with request body and returns response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        sessionId: 'session-1',
        operationId: 'op-1',
        state: 'open',
        ideConnected: true,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAiTeamClient({ baseUrl: 'http://localhost:3000' });
    const result = await client.ideOpenDiff({
      operationId: 'op-1',
      filePath: 'src/file.ts',
      originalContent: 'a',
      editType: 'modify',
      agentName: 'Leah Brooks',
      description: 'Edit file',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/ide/v1/edit/open-diff',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(result.sessionId).toBe('session-1');
  });

  it('calls status endpoint with encoded sessionId', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sessionId: 'session/1',
        operationId: 'op-1',
        state: 'ready',
        filePath: 'c:/repo/src/file.ts',
        createdAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        additions: 2,
        deletions: 1,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAiTeamClient({ baseUrl: 'http://localhost:3000' });
    await client.ideEditStatus('session/1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/ide/v1/edit/status?sessionId=session%2F1',
    );
  });

  it('throws on non-ok IDE lifecycle response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAiTeamClient({ baseUrl: 'http://localhost:3000' });

    await expect(client.ideCommitEdit({ sessionId: 'missing' })).rejects.toThrow(
      'Failed to commit IDE edit session',
    );
  });
});
