import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ToolManager } from './tool-manager.js';
import { ALL_TOOLS } from './index.js';
import { createPermissionEngine } from '../context/permission-adapter.js';
import { ContextLevel, type Agent } from '../types/index.js';

function makeAgent(id: string, readPatterns: string[] = ['**']): Agent {
  return {
    id,
    name: id,
    role: 'developer',
    contextLevel: ContextLevel.MODULE,
    filePath: `.ai-team/agents/${id}.agent.yml`,
    skillPath: `.ai-team/agents/${id}`,
    createdAt: new Date().toISOString(),
    permissions: {
      read: readPatterns,
      write: [],
      create: [],
      delete: [],
    },
    tools: ['fs_who_can', 'tool_can_i'],
  };
}

describe('access introspection tools', () => {
  it('fs_who_can defaults to list right', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-core-access-tools-'));
    try {
      const a = makeAgent('a', ['src/**']);
      const b = makeAgent('b', ['docs/**']);
      const engine = createPermissionEngine({ workspaceRoot, agents: [a, b] });

      const manager = new ToolManager(workspaceRoot, engine);
      for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

      const result = await manager.execute(a, 'fs_who_can', { path: 'src/file.ts' }, { workspaceRoot });
      expect(result.ok).toBe(true);
      const payload = result.result as any;
      expect(payload.right).toBe('list');
      expect(payload.contextIds).toContain('a');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('tool_can_i supports agent override', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-core-access-tools-'));
    try {
      const a = makeAgent('a', ['src/**']);
      const b = makeAgent('b', ['docs/**']);
      const engine = createPermissionEngine({ workspaceRoot, agents: [a, b] });

      const manager = new ToolManager(workspaceRoot, engine);
      for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

      const denied = await manager.execute(a, 'tool_can_i', { path: 'docs/readme.md' }, { workspaceRoot });
      expect(denied.ok).toBe(true);
      expect((denied.result as any).allowed).toBe(false);

      const allowed = await manager.execute(a, 'tool_can_i', { path: 'docs/readme.md', agentId: 'b' }, { workspaceRoot });
      expect(allowed.ok).toBe(true);
      expect((allowed.result as any).allowed).toBe(true);
      expect((allowed.result as any).contextId).toBe('b');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
