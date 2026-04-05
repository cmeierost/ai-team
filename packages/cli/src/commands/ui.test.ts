import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceApi = vi.hoisted(() => ({
  runUiCommand: vi.fn(),
}));

vi.mock('@ai-team/service', () => ({
  runUiCommand: serviceApi.runUiCommand,
}));

import { uiCommand } from './ui.js';

describe('uiCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceApi.runUiCommand.mockResolvedValue(undefined);
  });

  it('delegates ui startup to service layer with cwd and options', async () => {
    await uiCommand({ workspace: 'workspace-a' });

    expect(serviceApi.runUiCommand).toHaveBeenCalledWith(process.cwd(), {
      workspace: 'workspace-a',
    });
  });
});
