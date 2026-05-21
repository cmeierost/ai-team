import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ContextLevel, type Agent, type ICommand, type ICommandDescriptor } from '@ai-team/core';
import { ToolIdentity, ToolManager } from './tool-manager.js';
import { CommandRegistry } from '../command-registry-impl.js';

const permissivePathChecker = {
  canReadPath: () => true,
  canWritePath: () => true,
  canListPath: () => true,
  assertCanReadPath: () => undefined,
  assertCanWritePath: () => undefined,
};

const noopContainer = {
  resolve: () => undefined,
};

function makeTool(name: string, group?: string): ICommand {
  const metadata: ICommandDescriptor = {
    key: name,
    group,
    availableIn: { tool: true, cli: false, chat: false },
    description: `${group ? group + '_' : ''}${name}`,
    parameters: z.object({}),
  };
  return {
    metadata,
    async execute() {
      return { status: 'ok' as const };
    },
  };
}

function makeManager(...tools: ICommand[]): ToolManager {
  const registry = new CommandRegistry();
  for (const t of tools) registry.register(t.metadata, () => t);
  return new ToolManager('/workspace', permissivePathChecker, registry, noopContainer);
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
  };
}

describe('ToolManager wildcard selectors and default-deny policy', () => {
  it('denies everything by default when no tools are configured', async () => {
    const manager = makeManager(makeTool('tree', 'fs'));

    const agent = makeAgent({ tools: [] });
    expect(manager.getForAgent(agent)).toEqual([]);

    const permission = await manager.canExecute(agent, 'fs_tree', {});
    expect(permission.allowed).toBe(false);
    expect(permission.reason).toContain('not available');
  });

  it('supports wildcard allow selectors like fs_*', () => {
    const manager = makeManager(
      makeTool('tree', 'fs'),
      makeTool('read', 'fs'),
      makeTool('hire', 'hr')
    );

    const agent = makeAgent({ tools: ['fs_*'] });
    const available = manager
      .getForAgent(agent)
      .map((cmd) => ToolIdentity.key(cmd.metadata))
      .sort((a, b) => a.localeCompare(b));

    expect(available).toEqual(['fs_read', 'fs_tree']);
  });

  it('requires canonical selectors instead of short-name selectors', () => {
    const manager = makeManager(makeTool('tree', 'fs'), makeTool('read', 'fs'));

    const agent = makeAgent({ tools: ['tree'] });
    const available = manager.getForAgent(agent).map((cmd) => ToolIdentity.key(cmd.metadata));

    expect(available).toEqual([]);
  });

  it('applies disallowed selectors before allowed selectors', () => {
    const manager = makeManager(
      makeTool('tree', 'fs'),
      makeTool('read', 'fs'),
      makeTool('hire', 'hr')
    );

    const agent = makeAgent({
      tools: ['fs_*', 'hr_*'],
      disallowedTools: ['fs_tree', 'hr_*'],
    });

    const available = manager.getForAgent(agent).map((cmd) => ToolIdentity.key(cmd.metadata));
    expect(available).toEqual(['fs_read']);
  });
});
