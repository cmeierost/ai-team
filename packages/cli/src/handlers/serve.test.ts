import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceApi = vi.hoisted(() => ({
  serveApiCommand: vi.fn(),
}));

vi.mock('./serve-command.js', () => ({
  serveApiCommand: serviceApi.serveApiCommand,
}));

import { launchServer, launchServerWithUi } from './serve.js';

describe('serveCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceApi.serveApiCommand.mockResolvedValue(undefined);
  });

  it('delegates serve startup to service layer with cwd and options', async () => {
    await launchServer({ port: '4010', workspace: 'workspace-a' });

    expect(serviceApi.serveApiCommand).toHaveBeenCalledWith(process.cwd(), {
      port: '4010',
      workspace: 'workspace-a',
    });
  });

  it('delegates serve ui startup to service layer and forces API startup', async () => {
    await launchServerWithUi({ workspace: 'workspace-a' });

    expect(serviceApi.serveApiCommand).toHaveBeenCalledWith(process.cwd(), {
      workspace: 'workspace-a',
      ui: true,
    });
  });
});
