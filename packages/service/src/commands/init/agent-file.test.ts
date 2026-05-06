import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAgentDocumentStorage } from '@ai-team/core';

import { createAgentFile } from './agent-file.js';

function makeMockStorage(): IAgentDocumentStorage {
  return {
    buildAgentMarkdown: vi.fn().mockReturnValue('## Introduction\nhello'),
    saveAgentAsync: vi.fn().mockResolvedValue(undefined),
    loadAgentAsync: vi.fn().mockImplementation(async (filePath: string) => ({
      id: path.basename(filePath).replace(/\.agent\.md$/, ''),
      filePath,
    })),
    loadSkillAsync: vi.fn(),
    saveSkillAsync: vi.fn(),
    loadAgentSkillFileAsync: vi.fn(),
    loadInstructionFileAsync: vi.fn(),
    loadAllInstructionFilesAsync: vi.fn(),
  } as unknown as IAgentDocumentStorage;
}

describe('createAgentFile default governance permissions', () => {
  let mockStorage: IAgentDocumentStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage = makeMockStorage();
  });

  it('grants manage_agents by default for CEO', async () => {
    await createAgentFile('c:/repo', {
      name: 'Michael Brown',
      role: 'ceo',
      type: 'executive',
      contextLevel: 'organization',
      introduction: 'intro',
      personalityProfile: [],
    }, mockStorage);

    expect(mockStorage.saveAgentAsync).toHaveBeenCalledTimes(1);
    const saved = (mockStorage.saveAgentAsync as ReturnType<typeof vi.fn>).mock.calls[0][0];
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
    }, mockStorage);

    const saved = (mockStorage.saveAgentAsync as ReturnType<typeof vi.fn>).mock.calls[0][0];
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
    }, mockStorage);

    const saved = (mockStorage.saveAgentAsync as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(saved.permissions.manage_agents).toBeUndefined();
  });
});
