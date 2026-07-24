import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ContextLevel, type Agent, type ICommand, type ICommandDescriptor } from '@ai-team/core';
import { ToolIdentity, ToolManager } from './tool-manager.js';
import { CommandRegistry } from '../../command-dispatcher/command-registry.js';

const permissivePathChecker = {
  can: () => ({ allowed: true }),
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
  return new ToolManager(permissivePathChecker as any, registry, noopContainer as any);
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
    expect(manager.getForAgent(agent).map((cmd) => ToolIdentity.key(cmd.metadata))).toEqual(['fs_tree']);

    const permission = await manager.canExecute(agent, 'fs_tree', {});
    expect(permission.allowed).toBe(true);
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

    expect(available.sort()).toEqual(['fs_read', 'fs_tree']);
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

  it('includes com_handoff as a default tool when present', () => {
    const manager = makeManager(makeTool('handoff', 'com'));

    const agent = makeAgent({ tools: [] });
    const available = manager.getForAgent(agent).map((cmd) => ToolIdentity.key(cmd.metadata));

    expect(available).toEqual(['com_handoff']);
  });

  it('keeps com_handoff available even when listed in disallowedTools', () => {
    const manager = makeManager(makeTool('handoff', 'com'));

    const agent = makeAgent({ tools: [], disallowedTools: ['com_handoff'] });
    const available = manager.getForAgent(agent).map((cmd) => ToolIdentity.key(cmd.metadata));

    expect(available).toEqual(['com_handoff']);
  });

  it('resolves com_handoff when requested as com-handoff', () => {
    const manager = makeManager(makeTool('handoff', 'com'));

    const resolved = manager.get('com-handoff');
    expect(resolved).toBeDefined();
    expect(ToolIdentity.key(resolved!.metadata)).toBe('com_handoff');
  });

  it('resolves com-handoff when requested as com_handoff', () => {
    const manager = makeManager(makeTool('handoff', 'com'));

    const resolved = manager.get('com_handoff');
    expect(resolved).toBeDefined();
    expect(ToolIdentity.key(resolved!.metadata)).toBe('com_handoff');
  });
});

describe('ToolManager parameter normalization', () => {
  it('derives hidden context and workflow-bound parameters before validation and execution', async () => {
    const tool: ICommand<
      { sessionId: string; targetAgentId: string; query: string },
      { sessionId: string; targetAgentId: string; query: string }
    > = {
      metadata: {
        key: 'contextual',
        group: 'ops',
        availableIn: { tool: true },
        description: 'contextual tool',
        parameters: z.object({
          sessionId: z.string().min(1),
          targetAgentId: z.string().min(1),
          query: z.string().min(1),
        }),
        input: {
          contextParameters: ['sessionId'],
        },
        workflowInputBindings: {
          targetAgentId: { fromWorkflowData: 'handoff.targetAgentId' },
        },
      },
      execute: async (params) => ({
        status: 'ok',
        message: '',
        data: params,
      }),
    };
    const manager = makeManager(tool as ICommand);
    const agent = makeAgent({ tools: ['ops_contextual'] });

    const schema = manager.toSchema(agent);
    const properties = schema[0]?.parameters?.properties as Record<string, unknown>;
    expect(properties).toHaveProperty('query');
    expect(properties).not.toHaveProperty('sessionId');
    expect(properties).not.toHaveProperty('targetAgentId');

    const result = await manager.execute(
      agent,
      'ops_contextual',
      { query: 'status' },
      {
        history: [],
        sessionId: 'session-1',
        workflowState: {
          handoff: {
            targetAgentId: 'alex-morgan',
          },
        },
      }
    );

    expect(result.ok).toBe(true);
    expect(result.result).toEqual({
      status: 'ok',
      message: '',
      data: {
        sessionId: 'session-1',
        targetAgentId: 'alex-morgan',
        query: 'status',
      },
    });
  });
});

describe('ToolManager permission descriptors', () => {
  it('allows agent-delegation by default when delegatesTo is not configured', async () => {
    const manager = makeManager({
      metadata: {
        key: 'handoff',
        group: 'com',
        availableIn: { tool: true, cli: false, chat: false },
        description: 'handoff',
        parameters: z.object({ targetAgentId: z.string() }),
        permissionCheck: { type: 'agent-delegation', argsPath: 'targetAgentId' },
      },
      async execute() {
        return { status: 'ok' as const };
      },
    } as ICommand);

    const permission = await manager.canExecute(
      makeAgent({ tools: ['com_handoff'] }),
      'com_handoff',
      { targetAgentId: 'michael-brown' }
    );

    expect(permission.allowed).toBe(true);
  });

  it('authorizes com-handoff alias using canonical com_handoff policy', async () => {
    const manager = makeManager({
      metadata: {
        key: 'handoff',
        group: 'com',
        availableIn: { tool: true, cli: false, chat: false },
        description: 'handoff',
        parameters: z.object({ targetAgentId: z.string() }),
        permissionCheck: { type: 'agent-delegation', argsPath: 'targetAgentId' },
      },
      async execute() {
        return { status: 'ok' as const };
      },
    } as ICommand);

    const permission = await manager.canExecute(
      makeAgent({ tools: ['com_handoff'] }),
      'com-handoff',
      { targetAgentId: 'michael-brown' }
    );

    expect(permission.allowed).toBe(true);
  });

  it('allows com_handoff even when canDelegate is false', async () => {
    const manager = makeManager({
      metadata: {
        key: 'handoff',
        group: 'com',
        availableIn: { tool: true, cli: false, chat: false },
        description: 'handoff',
        parameters: z.object({ targetAgentId: z.string() }),
        permissionCheck: { type: 'agent-delegation', argsPath: 'targetAgentId' },
      },
      async execute() {
        return { status: 'ok' as const };
      },
    } as ICommand);

    const permission = await manager.canExecute(
      makeAgent({ tools: ['com_handoff'], canDelegate: false }),
      'com_handoff',
      { targetAgentId: 'michael-brown' }
    );

    expect(permission.allowed).toBe(true);
  });

  it('allows com_handoff even when delegatesTo does not include target', async () => {
    const manager = makeManager({
      metadata: {
        key: 'handoff',
        group: 'com',
        availableIn: { tool: true, cli: false, chat: false },
        description: 'handoff',
        parameters: z.object({ targetAgentId: z.string() }),
        permissionCheck: { type: 'agent-delegation', argsPath: 'targetAgentId' },
      },
      async execute() {
        return { status: 'ok' as const };
      },
    } as ICommand);

    const allowed = await manager.canExecute(
      makeAgent({ tools: ['com_handoff'], delegatesTo: ['michael-brown'] }),
      'com_handoff',
      { targetAgentId: 'michael-brown' }
    );
    const denied = await manager.canExecute(
      makeAgent({ tools: ['com_handoff'], delegatesTo: ['michael-brown'] }),
      'com_handoff',
      { targetAgentId: 'alex-morgan' }
    );

    expect(allowed.allowed).toBe(true);
    expect(denied.allowed).toBe(true);
  });

  it('allows delegation to configured handoff targets even when delegatesTo does not include target', async () => {
    const manager = makeManager({
      metadata: {
        key: 'handoff',
        group: 'com',
        availableIn: { tool: true, cli: false, chat: false },
        description: 'handoff',
        parameters: z.object({ targetAgentId: z.string() }),
        permissionCheck: { type: 'agent-delegation', argsPath: 'targetAgentId' },
      },
      async execute() {
        return { status: 'ok' as const };
      },
    } as ICommand);

    const permission = await manager.canExecute(
      makeAgent({
        tools: ['com_handoff'],
        delegatesTo: ['alex-morgan'],
        handoffs: [{ label: 'Escalate to CEO', agent: 'michael-brown' } as any],
      }),
      'com_handoff',
      { targetAgentId: 'michael-brown' }
    );

    expect(permission.allowed).toBe(true);
  });

  it('enforces manage-agents permission via agent.permissions.manage_agents', async () => {
    const manager = makeManager({
      metadata: {
        key: 'hire',
        group: 'hr',
        availableIn: { tool: true, cli: false, chat: false },
        description: 'hire',
        parameters: z.object({}),
        permissionCheck: { type: 'manage-agents' },
      },
      async execute() {
        return { status: 'ok' as const };
      },
    } as ICommand);

    const denied = await manager.canExecute(makeAgent({ tools: ['hr_hire'] }), 'hr_hire', {});
    const allowed = await manager.canExecute(
      makeAgent({ tools: ['hr_hire'], permissions: { read: [], write: [], manage_agents: true } }),
      'hr_hire',
      {}
    );

    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('manage_agents');
    expect(allowed.allowed).toBe(true);
  });
});
