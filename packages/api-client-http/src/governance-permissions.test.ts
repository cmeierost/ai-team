import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHttpAiTeamClient } from './index.js';

describe('HttpAiTeamClient governed permission mutations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('posts tool_allow with governance payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ changed: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAiTeamClient({ baseUrl: 'http://localhost:3000' });
    await client.toolAllow(
      { agent: 'sarah-lee', tool: 'fs_write_file' },
      { requestedBy: 'michael-brown', approvedByUser: true },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/tools/tool_allow',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          agent: 'sarah-lee',
          tool: 'fs_write_file',
          requestedBy: 'michael-brown',
          approvedByUser: true,
        }),
      }),
    );
  });

  it('posts access_allow with governance payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ mode: 'write', paths: ['src/**'] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAiTeamClient({ baseUrl: 'http://localhost:3000' });
    await client.accessAllow(
      { agent: 'alex-morgan', path: 'src/**', mode: 'write' },
      { requestedBy: 'emily-davis', approvedByUser: true },
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/files/agents/alex-morgan/access_allow',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          path: 'src/**',
          mode: 'write',
          requestedBy: 'emily-davis',
          approvedByUser: true,
        }),
      }),
    );
  });

  it('throws when tool_deny endpoint rejects request', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpAiTeamClient({ baseUrl: 'http://localhost:3000' });

    await expect(
      client.toolDeny(
        { agent: 'alex-morgan', tool: 'fs_delete_path' },
        { requestedBy: 'michael-brown', approvedByUser: false },
      ),
    ).rejects.toThrow('Failed to deny governed tool');
  });
});
