import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTeamClient } from '@ai-team/api-client';

const clientApi = vi.hoisted(() => ({
  stream: vi.fn(),
}));

const questionApi = vi.hoisted(() => ({
  confirm: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: questionApi.confirm,
}));

import { fireCommand } from './fire.js';

const client = {
  stream: clientApi.stream,
} as unknown as AiTeamClient;

describe('fire command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    questionApi.confirm.mockResolvedValue(true);
    clientApi.stream.mockReturnValue((async function* () {
      yield { kind: 'started', command: 'fire', timestamp: new Date().toISOString() };
      yield { kind: 'done', command: 'fire', timestamp: new Date().toISOString() };
    })());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards fire operation to api client', async () => {
    await fireCommand(client, 'maya', { force: true });

    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'fire',
      payload: {
        employeeQuery: 'maya',
        options: { force: true },
      },
    }, expect.objectContaining({
      signal: expect.any(Object),
    }));
    expect(questionApi.confirm).not.toHaveBeenCalled();
  });

  it('asks for confirmation when force is not set', async () => {
    await fireCommand(client, 'maya', {});

    expect(questionApi.confirm).toHaveBeenCalledTimes(1);
    expect(clientApi.stream).toHaveBeenCalledWith({
      command: 'fire',
      payload: {
        employeeQuery: 'maya',
        options: { force: true },
      },
    }, expect.objectContaining({
      signal: expect.any(Object),
    }));
  });

  it('does not invoke service when confirmation is declined', async () => {
    questionApi.confirm.mockResolvedValueOnce(false);

    await fireCommand(client, 'maya', {});

    expect(clientApi.stream).not.toHaveBeenCalled();
  });
});
