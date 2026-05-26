import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICliCommandClient } from '../cli-command-client.js';
import { renderToolsAllow, renderToolsDeny } from './tools.js';

const clientApi = vi.hoisted(() => ({
  streamInteraction: vi.fn(),
}));

const client = {
  streamInteraction: clientApi.streamInteraction,
} as unknown as ICliCommandClient;

describe('tools governance commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield { kind: 'started', command: 'toolsAllow', timestamp: new Date().toISOString() };
        yield { kind: 'done', command: 'toolsAllow', timestamp: new Date().toISOString() };
      })()
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards tools allow mutation through the stream client', async () => {
    await renderToolsAllow(client, {
      agent: 'sarah-lee',
      tool: 'fs_write_file',
      requestedBy: 'michael-brown',
      approvedByUser: true,
    });

    expect(clientApi.streamInteraction).toHaveBeenCalledWith(
      {
        command: 'toolsAllow',
        payload: {
          agent: 'sarah-lee',
          tool: 'fs_write_file',
          requestedBy: 'michael-brown',
          approvedByUser: true,
        },
      },
      expect.objectContaining({
        signal: expect.any(Object),
      })
    );
  });

  it('forwards tools deny mutation through the stream client', async () => {
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield { kind: 'started', command: 'toolsDeny', timestamp: new Date().toISOString() };
        yield { kind: 'done', command: 'toolsDeny', timestamp: new Date().toISOString() };
      })()
    );

    await renderToolsDeny(client, {
      agent: 'sarah-lee',
      tool: 'fs_write_file',
      requestedBy: 'michael-brown',
      approvedByUser: true,
    });

    expect(clientApi.streamInteraction).toHaveBeenCalledWith(
      {
        command: 'toolsDeny',
        payload: {
          agent: 'sarah-lee',
          tool: 'fs_write_file',
          requestedBy: 'michael-brown',
          approvedByUser: true,
        },
      },
      expect.objectContaining({
        signal: expect.any(Object),
      })
    );
  });
});
