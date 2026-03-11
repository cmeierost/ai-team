import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ToolManager } from './tool-manager.js';
import { ALL_TOOLS } from './index.js';
import { createAccessEngine } from '../context/access-adapter.js';
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
    tools: ['who_has_access', 'do_i_have_access'],
  };
}

describe('access introspection tools', () => {
  it('who_has_access defaults to list right', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-core-access-tools-'));
    try {
      const a = makeAgent('a', ['src/**']);
      const b = makeAgent('b', ['docs/**']);
      const engine = createAccessEngine({ workspaceRoot, agents: [a, b] });

      const manager = new ToolManager(workspaceRoot, engine);
      for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

      const result = await manager.execute(a, 'who_has_access', { path: 'src/file.ts' }, { workspaceRoot });
      expect(result.ok).toBe(true);
      const payload = result.result as any;
      expect(payload.right).toBe('list');
      expect(payload.contextIds).toContain('a');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('do_i_have_access supports agent override', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-core-access-tools-'));
    try {
      const a = makeAgent('a', ['src/**']);
      const b = makeAgent('b', ['docs/**']);
      const engine = createAccessEngine({ workspaceRoot, agents: [a, b] });

      const manager = new ToolManager(workspaceRoot, engine);
      for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);

      const denied = await manager.execute(a, 'do_i_have_access', { path: 'docs/readme.md' }, { workspaceRoot });
      expect(denied.ok).toBe(true);
      expect((denied.result as any).allowed).toBe(false);

      const allowed = await manager.execute(a, 'do_i_have_access', { path: 'docs/readme.md', agentId: 'b' }, { workspaceRoot });
      expect(allowed.ok).toBe(true);
      expect((allowed.result as any).allowed).toBe(true);
      expect((allowed.result as any).contextId).toBe('b');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
