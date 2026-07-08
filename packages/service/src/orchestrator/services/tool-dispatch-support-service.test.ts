import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { ExecutionContext } from '@ai-team/core';
import { describe, expect, it, vi } from 'vitest';

import { ToolDispatchSupportService } from './tool-dispatch-support-service.js';
import { ToolSerializationService } from './tool-serialization-service.js';
import { EmitService } from './emit-service.js';

describe('ToolDispatchSupportService', () => {
  const support = new ToolDispatchSupportService(
    'c:/workspace',
    new ToolSerializationService(),
    {} as any,
    {
      create: () => ({ save: vi.fn() }),
    } as any
  );

  it('flags policy-denied results from permission_denied status', () => {
    const denial = support.classifyToolDenial(
      true,
      {
        status: 'permission_denied',
        message: 'No access',
        blockedFiles: [{ filePath: 'secret.ts' }],
      },
      'No access'
    );

    expect(denial).toBeDefined();
    expect(denial?.kind).toBe('policy-denied');
    expect(denial?.reasonCode).toBe('permission_denied');
    expect(denial?.blockedPaths).toEqual(['secret.ts']);
  });

  it('requires confirmation for write tools', () => {
    expect(support.requiresConfirmation('fs_write_file')).toBe(true);
    expect(support.requiresConfirmation('tool_list')).toBe(false);
  });

  it('uses agentId fallback when ctx.agent is missing', async () => {
    const saved: Array<{ agentName: string }> = [];
    const storeFactory = {
      create: () => ({
        save: (data: { agentName: string }) => saved.push(data),
      }),
    };
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-'));
    const supportWithStore = new ToolDispatchSupportService(
      tmpDir,
      new ToolSerializationService(),
      {} as any,
      storeFactory as any
    );
    try {
      const ctx: ExecutionContext = {
        workspaceRoot: tmpDir,
        history: [],
        agentId: 'agent-x',
      };

      await supportWithStore.persistCodeEditProposal(
        {
          status: 'pending_approval',
          proposalId: 'proposal-1',
          description: 'test',
          warnings: [],
        },
        {
          changes: [
            {
              filePath: 'notes.txt',
              oldContent: '',
              newContent: 'hello',
            },
          ],
        },
        ctx,
        new EmitService(() => {})
      );

      expect(saved).toHaveLength(1);
      expect(saved[0].agentName).toBe('agent-x');
      await expect(fs.readFile(path.join(tmpDir, 'notes.txt'), 'utf8')).resolves.toBe('hello');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
