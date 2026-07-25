import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Agent } from '@ai-team/core';
import {
  CheckHiringCompletionCommand,
  FinalizeHiringCompletionCommand,
} from './hiring-completion.tool.js';

describe('hiring completion workflow tools', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function createWorkspace(): Promise<string> {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'hiring-completion-tool-'));
    tempRoots.push(workspaceRoot);
    await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'private'), { recursive: true });
    return workspaceRoot;
  }

  function createExecutionContext(content: string) {
    return {
      history: [
        {
          id: 777,
          isHuman: true,
          timestamp: new Date().toISOString(),
          content,
        },
      ],
      invocationSurface: 'chat',
    } as any;
  }

  function createAgent(
    id: string,
    name: string,
    role: string,
    reportsTo?: string,
    specializations?: string[]
  ): Agent {
    return {
      id,
      name,
      role,
      reportsTo,
      specializations,
      contextLevel: 'organization' as any,
      filePath: `${id}.md`,
      skillPath: `${id}.skills.md`,
      createdAt: new Date().toISOString(),
    } as Agent;
  }

  it('reports unmet conditions when no canonical Head of Development exists', async () => {
    const workspaceRoot = await createWorkspace();
    const check = new CheckHiringCompletionCommand(
      workspaceRoot,
      { getAllAgentsAsync: async () => [createAgent('a-1', 'Bob', 'Backend Lead', 'ceo-1')] },
      {
        loadAsync: async () => ({ list: ['**/*'], read: ['**/*'], write: ['.ai-team/**/*', 'docs/**/*'] }),
        saveAsync: async () => undefined,
      }
    );

    const response = await check.execute(
      { workspaceRoot, ceoAgentId: 'ceo-1', hrAgentId: 'hr-1' },
      createExecutionContext('Looks good.')
    );

    expect(response.status).toBe('ok');
    expect(response.data?.done).toBe(false);
    expect(response.data?.unmet.map((item) => item.code)).toContain('head_of_development_missing');
  });

  it('finalizes idempotently with canonical role, reporting, permissions, and explicit approval', async () => {
    const workspaceRoot = await createWorkspace();
    const ceo = createAgent('ceo-1', 'Michael Brown', 'CEO');
    const hr = createAgent('hr-1', 'Emily Davis', 'HR Director', 'ceo-1');
    const hod = createAgent(
      'hod-1',
      'Alice Chen',
      'Head of Development',
      'ceo-1',
      ['technical delivery', 'engineering leadership']
    );

    const permissionStorage = {
      loadAsync: async (agentId: string) =>
        agentId === 'hod-1'
          ? { list: ['**/*'], read: ['**/*'], write: ['.ai-team/**/*', 'docs/**/*'] }
          : { list: ['**/*'], read: ['**/*'], write: ['.ai-team/**/*'] },
      saveAsync: async () => undefined,
    };

    const check = new CheckHiringCompletionCommand(
      workspaceRoot,
      { getAllAgentsAsync: async () => [ceo, hr, hod] },
      permissionStorage
    );
    const finalize = new FinalizeHiringCompletionCommand(
      workspaceRoot,
      { getAllAgentsAsync: async () => [ceo, hr, hod] },
      permissionStorage
    );

    const ctx = createExecutionContext('I approve hiring Alice Chen as Head of Development.');
    const checkResponse = await check.execute({ workspaceRoot, ceoAgentId: 'ceo-1', hrAgentId: 'hr-1' }, ctx);
    expect(checkResponse.status).toBe('ok');
    expect(checkResponse.data?.done).toBe(true);
    expect(checkResponse.data?.headOfDevelopment?.agentId).toBe('hod-1');

    const first = await finalize.execute({ workspaceRoot, ceoAgentId: 'ceo-1', hrAgentId: 'hr-1' }, ctx);
    const second = await finalize.execute({ workspaceRoot, ceoAgentId: 'ceo-1', hrAgentId: 'hr-1' }, ctx);
    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(first.data).toEqual(second.data);
    expect(first.data?.headOfDevelopment.canonicalRole).toBe('head-of-development');
  });
});

