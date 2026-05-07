import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ContextLevel, type Agent, type AgentTool } from '@ai-team/core';
import { ToolManager, toolKey } from './tool-manager.js';

function makeTool(name: string, group?: string): AgentTool {
  return {
    name,
    key: name,
    group,
    availableIn: { tool: true },
    description: `${group ? group + '_' : ''}${name}`,
    parameters: z.object({}),
    async execute() {
      return { ok: true };
    },
  } as AgentTool;
}

function makeAgent(overrides?: Partial<Agent>): Agent {
  return {
    id: 'agent-a',
    name: 'Agent A',
    role: 'developer',
    contextLevel: ContextLevel.MODULE,
    filePath: '.ai-team/agents/agent-a.agent.md',
    skillPath: '.ai-team/agents/agent-a.md',
    createdAt: new Date().toISOString(),
    permissions: {
      read: ['**'],
      write: ['**'],
    },
    ...overrides,
  } as Agent;
}

describe('ToolManager wildcard selectors and default-deny policy', () => {
  it('denies everything by default when no tools are configured', async () => {
    const manager = new ToolManager('/workspace');
    manager.register(makeTool('tree', 'fs'));

    const agent = makeAgent({ tools: [] });
    expect(manager.getForAgent(agent)).toEqual([]);

    const permission = await manager.canExecute(agent, 'fs_tree', {});
    expect(permission.allowed).toBe(false);
    expect(permission.reason).toContain('not available');
  });

  it('supports wildcard allow selectors like fs_*', () => {
    const manager = new ToolManager('/workspace');
    manager.register(makeTool('tree', 'fs'));
    manager.register(makeTool('read', 'fs'));
    manager.register(makeTool('hire', 'hr'));

    const agent = makeAgent({ tools: ['fs_*'] });
    const available = manager
      .getForAgent(agent)
      .map(toolKey)
      .sort((a, b) => a.localeCompare(b));

    expect(available).toEqual(['fs_read', 'fs_tree']);
  });

  it('requires canonical selectors instead of short-name selectors', () => {
    const manager = new ToolManager('/workspace');
    manager.register(makeTool('tree', 'fs'));
    manager.register(makeTool('read', 'fs'));

    const agent = makeAgent({ tools: ['tree'] });
    const available = manager.getForAgent(agent).map(toolKey);

    expect(available).toEqual([]);
  });

  it('applies disallowed selectors before allowed selectors', () => {
    const manager = new ToolManager('/workspace');
    manager.register(makeTool('tree', 'fs'));
    manager.register(makeTool('read', 'fs'));
    manager.register(makeTool('hire', 'hr'));

    const agent = makeAgent({
      tools: ['fs_*', 'hr_*'],
      disallowedTools: ['fs_tree', 'hr_*'],
    });

    const available = manager.getForAgent(agent).map(toolKey);
    expect(available).toEqual(['fs_read']);
  });
});
