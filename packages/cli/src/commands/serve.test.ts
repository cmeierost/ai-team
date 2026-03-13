import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceApi = vi.hoisted(() => ({
  serveApiCommand: vi.fn(),
}));

vi.mock('@ai-team/service', () => ({
  serveApiCommand: serviceApi.serveApiCommand,
}));

import { serveCommand } from './serve.js';

describe('serveCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceApi.serveApiCommand.mockResolvedValue(undefined);
  });

  it('delegates serve startup to service layer with cwd and options', async () => {
    await serveCommand({ port: '4010', workspace: 'workspace-a' });

    expect(serviceApi.serveApiCommand).toHaveBeenCalledWith(process.cwd(), {
      port: '4010',
      workspace: 'workspace-a',
    });
  });
});