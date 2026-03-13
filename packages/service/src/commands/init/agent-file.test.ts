import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreApi = vi.hoisted(() => ({
  buildAgentMarkdown: vi.fn(),
  saveAgent: vi.fn(),
  loadAgent: vi.fn(),
}));

vi.mock('@ai-team/core', () => ({
  ...coreApi,
}));

import { createAgentFile } from './agent-file.js';

describe('createAgentFile default governance permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    coreApi.buildAgentMarkdown.mockReturnValue('## Introduction\nhello');
    coreApi.saveAgent.mockResolvedValue(undefined);
    coreApi.loadAgent.mockImplementation(async (filePath: string) => ({
      id: path.basename(filePath).replace(/\.agent\.md$/, ''),
      filePath,
    }));
  });

  it('grants manage_agents by default for CEO', async () => {
    await createAgentFile('c:/repo', {
      name: 'Michael Brown',
      role: 'ceo',
      type: 'executive',
      contextLevel: 'organization',
      introduction: 'intro',
      personalityProfile: [],
    });

    expect(coreApi.saveAgent).toHaveBeenCalledTimes(1);
    const saved = coreApi.saveAgent.mock.calls[0][0];
    expect(saved.permissions.manage_agents).toBe(true);
  });

  it('grants manage_agents by default for HR Director', async () => {
    await createAgentFile('c:/repo', {
      name: 'Emily Davis',
      role: 'hr-director',
      type: 'executive',
      contextLevel: 'organization',
      introduction: 'intro',
      personalityProfile: [],
    });

    const saved = coreApi.saveAgent.mock.calls[0][0];
    expect(saved.permissions.manage_agents).toBe(true);
  });

  it('does not grant manage_agents by default for other executive roles', async () => {
    await createAgentFile('c:/repo', {
      name: 'Sarah Lee',
      role: 'chief-architect',
      type: 'executive',
      contextLevel: 'organization',
      introduction: 'intro',
      personalityProfile: [],
    });

    const saved = coreApi.saveAgent.mock.calls[0][0];
    expect(saved.permissions.manage_agents).toBeUndefined();
  });
});
