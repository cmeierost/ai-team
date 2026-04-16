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
      { agentId: 'hr-director', workspaceRoot: '/workspace' }
    );

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'log', level: 'info' }));
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
      { agentId: 'michael-brown', workspaceRoot: '/workspace' }
    );
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'log', level: 'info' }));
  });
});

describe('/context slash command', () => {
  it('hides the latest visible non-human message on /context remove', async () => {
    const commands = buildDefaultSlashCommands();
    const contextCommand = commands.find((c) => c.key === 'context');
    expect(contextCommand).toBeDefined();
    if (!contextCommand) {
      throw new Error('Expected /context command to be registered');
    }

    const emit = vi.fn();
    const listSessionMessages = vi.fn(async () => [
      {
        id: 11,
        timestamp: '2026-04-15T00:00:00.000Z',
        from: 'human',
        isHuman: true,
        content: 'hello',
      },
      {
        id: 12,
        timestamp: '2026-04-15T00:00:01.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'draft output',
        hiddenFromLlm: false,
      },
    ]);
    const setMessageHiddenFromLlm = vi.fn(async () => true);
    const getSessionMessages = vi.fn(async () => []);

    const ctx: OrchestratorContext = {
      agent: { id: 'architect-agent', name: 'Architect', role: 'architect' } as any,
      workspaceRoot: '/workspace',
      sessionId: 'sess-1',
      hooks: { emit } as any,
      toolManager: {} as any,
      sessionManager: {
        listSessionMessages,
        setMessageHiddenFromLlm,
        getSessionMessages,
      } as any,
      agentManager: {} as any,
      skillManager: {} as any,
      llmService: {} as any,
      contextManager: {} as any,
      history: [],
    };

    await contextCommand.execute('remove', ctx);

    expect(setMessageHiddenFromLlm).toHaveBeenCalledWith(12, true);
    expect(getSessionMessages).toHaveBeenCalledWith('sess-1');
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ kind: 'log', level: 'info' }));
  });

  it('summarizes a targeted tool-result message via /context summarize --message', async () => {
    const commands = buildDefaultSlashCommands();
    const contextCommand = commands.find((c) => c.key === 'context');
    expect(contextCommand).toBeDefined();
    if (!contextCommand) {
      throw new Error('Expected /context command to be registered');
    }

    const emit = vi.fn();
    const listSessionMessages = vi.fn(async () => [
      {
        id: 21,
        timestamp: '2026-04-15T00:00:00.000Z',
        from: 'architect-agent',
        isHuman: false,
        content: 'Tool result envelope',
        tool_calls: [
          {
            id: 55,
            tool: 'fs_read',
            params: { filePath: 'src/index.ts' },
            result: { content: 'line1\nline2' },
          },
        ],
      },
    ]);
    const summarizeForContextAsync = vi.fn(async () => '- key finding');
    const updateToolCallLlmResult = vi.fn(async () => undefined);
    const getSessionMessages = vi.fn(async () => []);

    const ctx: OrchestratorContext = {
      agent: { id: 'architect-agent', name: 'Architect', role: 'architect' } as any,
      workspaceRoot: '/workspace',
      sessionId: 'sess-1',
      hooks: { emit } as any,
      toolManager: {} as any,
      sessionManager: {
        listSessionMessages,
        summarizeForContextAsync,
        updateToolCallLlmResult,
        getSessionMessages,
      } as any,
      agentManager: {} as any,
      skillManager: {} as any,
      llmService: {} as any,
      contextManager: {} as any,
      history: [],
    };

    await contextCommand.execute('summarize --message 21 --instruction "focus on errors"', ctx);

    expect(summarizeForContextAsync).toHaveBeenCalled();
    expect(updateToolCallLlmResult).toHaveBeenCalledWith(55, '- key finding');
    expect(getSessionMessages).toHaveBeenCalledWith('sess-1');
  });
});
