import { describe, expect, it, vi } from 'vitest';
import { buildDefaultSlashCommands } from './slash-commands.js';
import type { OrchestratorContext } from './pipeline-context.js';

describe('/tool slash command', () => {
  it('executes ToolManager tool call with parsed JSON args', async () => {
    const commands = buildDefaultSlashCommands();
    const toolCommand = commands.find((c) => c.key === 'tool');
    expect(toolCommand).toBeDefined();
    if (!toolCommand) {
      throw new Error('Expected /tool command to be registered');
    }

    const execute = vi.fn(async () => ({ ok: true, result: { allowed: true } }));
    const emit = vi.fn();

    const ctx: OrchestratorContext = {
      agent: { id: 'hr-director', name: 'Robert Davis', role: 'hr-director' } as any,
      workspaceRoot: '/workspace',
      sessionId: 'sess-1',
      hooks: { emit } as any,
      toolManager: { execute } as any,
      sessionManager: {} as any,
      agentManager: {} as any,
      skillManager: {} as any,
      llmService: {} as any,
      contextManager: {} as any,
      history: [],
    };

    await toolCommand.execute('tool_can_i {"path":"docs/readme.md"}', ctx);

    expect(execute).toHaveBeenCalledWith(
      ctx.agent,
      'tool_can_i',
      { path: 'docs/readme.md' },
      { agentId: 'hr-director', workspaceRoot: '/workspace' },
    );

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'log', level: 'info' }),
    );
  });
});

describe('/list slash command', () => {
  it('delegates to team_list tool and renders members', async () => {
    const commands = buildDefaultSlashCommands();
    const listCommand = commands.find((c) => c.key === 'list');
    expect(listCommand).toBeDefined();
    if (!listCommand) {
      throw new Error('Expected /list command to be registered');
    }

    const execute = vi.fn(async () => ({
      ok: true,
      result: {
        type: 'team_list_result',
        members: [
          { agentId: 'michael-brown', agentName: 'Michael Brown', agentRole: 'ceo' },
          { agentId: 'robert-davis', agentName: 'Robert Davis', agentRole: 'hr-director' },
        ],
        timestamp: new Date().toISOString(),
      },
    }));
    const emit = vi.fn();

    const ctx: OrchestratorContext = {
      agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo' } as any,
      workspaceRoot: '/workspace',
      sessionId: 'sess-1',
      hooks: { emit } as any,
      toolManager: { execute } as any,
      sessionManager: {} as any,
      agentManager: {} as any,
      skillManager: {} as any,
      llmService: {} as any,
      contextManager: {} as any,
      history: [],
    };

    await listCommand.execute('', ctx);

    expect(execute).toHaveBeenCalledWith(
      ctx.agent,
      'team_list',
      {},
      { agentId: 'michael-brown', workspaceRoot: '/workspace' },
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'log', level: 'info' }),
    );
  });
});
