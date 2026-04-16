import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '@ai-team/api-client';

import { renderAgentList } from './list.js';

describe('list command', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prints JSON output for filtered agents', async () => {
    const employees: Agent[] = [
      { name: 'Maya', role: 'engineer', features: ['auth'] },
    ];

    renderAgentList(employees, { json: true });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const output = logSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed).toEqual([{ name: 'Maya', role: 'engineer', features: ['auth'] }]);
  });

  it('prints empty-state message when no members are found', async () => {
    renderAgentList([], {});

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(String(logSpy.mock.calls[0][0])).toContain('No team members found');
  });
});
