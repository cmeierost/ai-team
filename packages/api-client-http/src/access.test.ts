import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpAiTeamClient } from './index.js';

describe('HttpAiTeamClient access endpoints', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests access candidates from the HTTP API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ contexts: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAiTeamClient({ baseUrl: 'http://localhost:3000' });
    await client.whoHasPermission({ path: 'docs/readme.md', right: 'list' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/access/who?path=docs%2Freadme.md&right=list',
    );
  });

  it('requests a scoped access check from the HTTP API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ allowed: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAiTeamClient({ baseUrl: 'http://localhost:3000' });
    await client.doIHavePermission({ path: 'src/index.ts', right: 'write', agent: 'ethan-carter' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/access/can?path=src%2Findex.ts&right=write&agent=ethan-carter',
    );
  });

  it('requests permission overlap analysis from the HTTP API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ kind: 'files', rights: {} }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAiTeamClient({ baseUrl: 'http://localhost:3000' });
    await client.analyzePermissionOverlap({ mode: 'files', agentId: 'alex-morgan', maxDepth: 12 });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/access/overlap?mode=files&agent=alex-morgan&maxDepth=12',
    );
  });
});
