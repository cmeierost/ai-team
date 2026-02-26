import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiTeamClient } from '@ai-team/api-client';

const clientApi = vi.hoisted(() => ({
  listEmployees: vi.fn(),
}));

import { listCommand } from './list.js';

const client = {
  listEmployees: clientApi.listEmployees,
} as unknown as AiTeamClient;

describe('list command', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    clientApi.listEmployees.mockResolvedValue([]);

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('prints JSON output for filtered agents', async () => {
    clientApi.listEmployees.mockResolvedValue([
      { name: 'Maya', role: 'engineer', features: ['auth'] },
    ]);

    await listCommand(client, { role: 'engineer', json: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([{ name: 'Maya', role: 'engineer', features: ['auth'] }]);
    expect(clientApi.listEmployees).toHaveBeenCalledWith({ role: 'engineer', feature: undefined });
  });

  it('prints empty-state message when no members are found', async () => {
    clientApi.listEmployees.mockResolvedValue([]);

    await listCommand(client, {});

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain('No team members found');
  });
});
