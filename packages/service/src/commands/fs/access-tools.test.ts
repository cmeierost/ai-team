import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { TOOL_SERVICE_TOKENS as T } from '@ai-team/core';
import { ToolManager } from '../../tools/tool-manager.js';
import { ALL_TOOLS } from '../../tools/catalog/index.js';
import { ContextLevel, type Agent } from '@ai-team/core';

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
    },
    tools: ['access_who_can', 'access_can_i', 'access_analyze_permission_overlap'],
  };
}

async function setupManager(workspaceRoot: string, agents: Agent[]): Promise<ToolManager> {
  const manager = new ToolManager(workspaceRoot);
  for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);
  return manager;
}

function makeAgentManager(agents: Agent[], analyzeResult?: unknown) {
  return {
    async getAllAgentsAsync() {
      return agents;
    },
    async getAgentAsync(id: string) {
      return agents.find((agent) => agent.id === id);
    },
    async analyzeWorkspacePermissionOverlap() {
      if (analyzeResult === undefined) {
        throw new Error('No overlap analysis result configured for test.');
      }
      return analyzeResult;
    },
  };
}

describe('access introspection tools', () => {
  it('fs_who_can defaults to list right', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-core-access-tools-'));
    try {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'agents'), { recursive: true });
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'a.agent.md'),
        '---\nid: a\nname: a\nrole: developer\ncontextLevel: module\npermissions:\n  read: ["src/**"]\n  write: []\ntools:\n  - who_can\n  - can_i\n  - analyze_permission_overlap\n---\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'b.agent.md'),
        '---\nid: b\nname: b\nrole: developer\ncontextLevel: module\npermissions:\n  read: ["docs/**"]\n  write: []\ntools:\n  - who_can\n  - can_i\n  - analyze_permission_overlap\n---\n',
        'utf8'
      );

      const a = makeAgent('a', ['src/**']);
      const b = makeAgent('b', ['docs/**']);
      const manager = await setupManager(workspaceRoot, [a, b]);
      const agentManager = makeAgentManager([a, b]);

      const result = await manager.execute(
        a,
        'access_who_can',
        { path: 'src/file.ts' },
        {
          workspaceRoot,
          resolve: (token) => {
            if (token.id === T.AgentManager.id) return agentManager as never;
            throw new Error(`Unexpected token: ${token.id}`);
          },
        }
      );
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
      await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'agents'), { recursive: true });
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'a.agent.md'),
        '---\nid: a\nname: a\nrole: developer\ncontextLevel: module\npermissions:\n  read: ["src/**"]\n  write: []\ntools:\n  - who_can\n  - can_i\n---\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'b.agent.md'),
        '---\nid: b\nname: b\nrole: developer\ncontextLevel: module\npermissions:\n  read: ["docs/**"]\n  write: []\ntools:\n  - who_can\n  - can_i\n---\n',
        'utf8'
      );

      const a = makeAgent('a', ['src/**']);
      const b = makeAgent('b', ['docs/**']);
      const manager = await setupManager(workspaceRoot, [a, b]);
      const agentManager = makeAgentManager([a, b]);

      const denied = await manager.execute(
        a,
        'access_can_i',
        { path: 'docs/readme.md', right: 'read' },
        {
          workspaceRoot,
          resolve: (token) => {
            if (token.id === T.AgentManager.id) return agentManager as never;
            throw new Error(`Unexpected token: ${token.id}`);
          },
        }
      );
      expect(denied.ok).toBe(true);
      expect((denied.result as any).allowed).toBe(true);

      const allowed = await manager.execute(
        a,
        'access_can_i',
        { path: 'docs/readme.md', right: 'read', agentId: 'b' },
        {
          workspaceRoot,
          resolve: (token) => {
            if (token.id === T.AgentManager.id) return agentManager as never;
            throw new Error(`Unexpected token: ${token.id}`);
          },
        }
      );
      expect(allowed.ok).toBe(true);
      expect((allowed.result as any).allowed).toBe(true);
      expect((allowed.result as any).contextId).toBe('b');
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('analyze_permission_overlap returns file-based ownership data', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-core-access-tools-'));
    try {
      await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'agents'), { recursive: true });
      await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'a.agent.md'),
        '---\nid: a\nname: Agent A\nrole: developer\ncontextLevel: module\ntools:\n  - analyze_permission_overlap\n---\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'b.agent.md'),
        '---\nid: b\nname: Agent B\nrole: developer\ncontextLevel: module\ntools:\n  - analyze_permission_overlap\n---\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'a.perm'),
        '[write]\nsrc/**/*.ts\n',
        'utf8'
      );
      await fs.writeFile(
        path.join(workspaceRoot, '.ai-team', 'agents', 'b.perm'),
        '[write]\nsrc/shared.ts\n',
        'utf8'
      );
      await fs.writeFile(path.join(workspaceRoot, 'src', 'shared.ts'), 'one\ntwo\n', 'utf8');
      await fs.writeFile(path.join(workspaceRoot, 'src', 'solo.ts'), 'solo\n', 'utf8');

      const a = makeAgent('a', ['src/**']);
      const b = makeAgent('b', ['src/**']);
      const manager = await setupManager(workspaceRoot, [a, b]);
      const agentManager = makeAgentManager([a, b], {
        kind: 'files',
        agentFocus: { agentId: 'a' },
        rights: {
          write: {
            overlappingFiles: [{ path: 'src/shared.ts' }],
          },
        },
      });

      const result = await manager.execute(
        a,
        'access_analyze_permission_overlap',
        { mode: 'files', agentId: 'a' },
        {
          workspaceRoot,
          resolve: (token) => {
            if (token.id === T.AgentManager.id) return agentManager as never;
            throw new Error(`Unexpected token: ${token.id}`);
          },
        }
      );
      expect(result.ok).toBe(true);
      expect((result.result as any).kind).toBe('files');
      expect((result.result as any).agentFocus.agentId).toBe('a');
      expect(
        (result.result as any).rights.write.overlappingFiles.some(
          (file: { path: string }) => file.path === 'src/shared.ts'
        )
      ).toBe(true);
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
