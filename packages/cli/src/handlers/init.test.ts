import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICliCommandClient } from '../cli-command-client.js';

const chatApi = vi.hoisted(() => ({
  renderChat: vi.fn(async () => undefined),
}));

vi.mock('./chat.js', () => chatApi);

import { renderInit } from './init.js';

describe('init command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs init as an embedded workflow in the shared chat TUI', async () => {
    const client = {} as ICliCommandClient;
    const questionService = { attachPresenter: vi.fn() } as any;

    await renderInit(client, { force: true }, { questionService });

    expect(chatApi.renderChat).toHaveBeenCalledWith(
      client,
      undefined,
      { oneShot: true },
      false,
      undefined,
      'init',
      { options: { force: true } },
      { questionService }
    );
  });
});
