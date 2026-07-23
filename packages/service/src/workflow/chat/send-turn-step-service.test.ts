import { describe, expect, it, vi } from 'vitest';
import type { Agent, ExecutionContext } from '@ai-team/core';
import { SendTurnStepService } from './send-turn-step-service.js';

function makeTool(name: string) {
  const [group, ...rest] = name.split('_');
  return {
    metadata: {
      key: rest.join('_'),
      group,
      description: `${name} description`,
      availableIn: { tool: true },
    },
    execute: async () => ({ ok: true }),
  };
}

function createStepService(overrides?: {
  sessionManager?: any;
  agentManager?: any;
  chatSkillService?: any;
  llmService?: any;
  llmInvokeService?: any;
  toolDispatcher?: any;
  toolSchemaService?: any;
  runtimeHooks?: any;
  emitService?: any;
  developerIdentityService?: any;
}) {
  const sessionManager =
    overrides?.sessionManager ??
    ({
      appendMessage: vi.fn(async () => null),
    } as any);
  const agentManager =
    overrides?.agentManager ??
    ({
      getAllAgentsAsync: vi.fn(async () => []),
      recordInteractionAsync: vi.fn(async () => undefined),
    } as any);
  const chatSkillService =
    overrides?.chatSkillService ??
    ({
      resolveSkillsForTurnAsync: vi.fn(async () => ({ skills: [] })),
    } as any);
  const llmService = overrides?.llmService ?? ({ generateTitle: vi.fn() } as any);
  const llmInvokeService =
    overrides?.llmInvokeService ??
    ({
      invokeAsync: vi.fn(async () => ({ fullResponse: 'ok', structuredResults: [] })),
    } as any);
  const toolDispatcher = overrides?.toolDispatcher ?? ({ dispatch: vi.fn() } as any);
  const toolSchemaService =
    overrides?.toolSchemaService ??
    ({
      buildToolDefinitions: vi.fn((tools: any[]) =>
        tools.map((t) => ({ name: `${t.metadata.group}_${t.metadata.key}` }))
      ),
    } as any);
  const runtimeHooks = overrides?.runtimeHooks ?? ({} as any);
  const emitService =
    overrides?.emitService ?? ({ log: vi.fn(), emit: vi.fn(), status: vi.fn() } as any);
  const developerIdentityService =
    overrides?.developerIdentityService ??
    ({
      getUserName: vi.fn(() => 'Clemens Meier'),
    } as any);

  return {
    stepService: new SendTurnStepService(
      sessionManager,
      agentManager,
      chatSkillService,
      llmService,
      llmInvokeService,
      toolDispatcher,
      toolSchemaService,
      runtimeHooks,
      emitService,
      developerIdentityService
    ),
    sessionManager,
    agentManager,
    chatSkillService,
    llmService,
    llmInvokeService,
    toolDispatcher,
    toolSchemaService,
    runtimeHooks,
    emitService,
    developerIdentityService,
  };
}

describe('SendTurnStepService.prepareMessagesAsync', () => {
  it('identifies the configured developer as the human conversation partner', async () => {
    const plugins = {
      compressor: {
        compress: vi.fn(async (history: unknown[]) => history),
      },
      contextBuilder: {
        build: vi.fn(async () => [{ role: 'user', content: "what's up today?" }]),
      },
      enrichers: [],
      ragProvider: {
        retrieve: vi.fn(async () => null),
      },
    } as any;
    const ctx = {
      agent: { id: 'sarah-lee', name: 'Sarah Lee' },
      sessionId: 'session-1',
      history: [],
    } as unknown as ExecutionContext;

    const { stepService } = createStepService({
      developerIdentityService: {
        getUserName: vi.fn(() => 'Clemens Meier'),
      },
    });

    const messages = await stepService.prepareMessagesAsync("what's up today?", plugins, ctx);

    expect(messages[0]).toEqual({
      role: 'system',
      content: expect.stringContaining(
        'You are speaking directly with Clemens Meier, the human developer using ai-team.'
      ),
    });
    expect(messages[0]?.content).toContain(
      'Clemens Meier is the author of messages with the user role'
    );
    expect(messages[0]?.content).toContain('usually use their first name, Clemens');
    expect(messages[1]).toEqual({ role: 'user', content: "what's up today?" });
  });

  it('labels a handoff continuation as internal system context', async () => {
    const plugins = {
      compressor: { compress: vi.fn(async (history: unknown[]) => history) },
      contextBuilder: { build: vi.fn(async () => []) },
      enrichers: [],
      ragProvider: { retrieve: vi.fn(async () => null) },
    } as any;
    const ctx = {
      agent: { id: 'michael-brown', name: 'Michael Brown' },
      sessionId: 'session-1',
      history: [],
    } as unknown as ExecutionContext;
    const { stepService } = createStepService();

    const messages = await stepService.prepareMessagesAsync(
      '[Handoff received] continue naturally',
      plugins,
      ctx,
      { internalInstruction: '[Handoff received] continue naturally' }
    );

    expect(messages).toContainEqual({
      role: 'system',
      content: expect.stringContaining(
        'Internal conversation transition (not written by the developer)'
      ),
    });
    expect(messages).not.toContainEqual(
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('[Handoff received]'),
      })
    );
  });
});

describe('SendTurnStepService.resolveSkillsAndToolsAsync', () => {
  it('describes only agent-allowed discovered tools', async () => {
    const agent = {
      id: 'victor-alvarez',
      name: 'Victor Alvarez',
      role: 'assistant',
      tools: ['fs_*'],
      disallowedTools: [],
    } as unknown as Agent;

    const ctx = {
      agent,
      workspaceRoot: '/workspace',
      sessionId: 'session-1',
      history: [],
    } as unknown as ExecutionContext;

    const agentManager = {
      getAllAgentsAsync: vi.fn(async () => [agent]),
      recordInteractionAsync: vi.fn(async () => undefined),
    } as any;

    const chatSkillService = {
      resolveSkillsForTurnAsync: vi.fn(async () => ({ skills: [] })),
    } as any;

    const toolSchemaService = {
      buildToolDefinitions: vi.fn((tools: any[]) =>
        tools.map((tool) => ({ name: `${tool.metadata.group}_${tool.metadata.key}` }))
      ),
    } as any;

    const plugins = {
      toolResolver: {
        resolve: vi.fn(async () => [makeTool('fs_read')]),
      },
      mcpGateway: {
        discover: vi.fn(async () => [makeTool('mcp_secret')]),
      },
      llmSelector: {
        select: vi.fn(async () => undefined),
      },
    } as any;

    const { stepService } = createStepService({
      chatSkillService,
      agentManager,
      toolSchemaService,
    });
    const resolved = await stepService.resolveSkillsAndToolsAsync('read file', plugins, ctx);

    expect(resolved.toolDefs.map((tool) => tool.name)).toEqual(['fs_read']);
    expect(resolved.allTools.map((tool) => `${tool.metadata.group}_${tool.metadata.key}`)).toEqual([
      'fs_read',
    ]);
  });

  it('delegates skill resolution to ChatSkillService across turns', async () => {
    const agent = {
      id: 'clara-bishop',
      name: 'Clara Bishop',
      role: 'frontend-quality-engineer',
      tools: ['fs_*'],
      disallowedTools: [],
    } as unknown as Agent;

    const ctx = {
      agent,
      workspaceRoot: '/workspace',
      sessionId: 'session-1',
      history: [],
    } as unknown as ExecutionContext;

    const chatSkillService = {
      resolveSkillsForTurnAsync: vi.fn(async () => ({ skills: [] })),
    } as any;

    const plugins = {
      toolResolver: { resolve: vi.fn(async () => [makeTool('fs_read')]) },
      mcpGateway: { discover: vi.fn(async () => []) },
      llmSelector: { select: vi.fn(async () => undefined) },
    } as any;

    const { stepService } = createStepService({
      chatSkillService,
      agentManager: {
        getAllAgentsAsync: vi.fn(async () => [agent]),
        recordInteractionAsync: vi.fn(async () => undefined),
      } as any,
    });
    await stepService.resolveSkillsAndToolsAsync('turn-1', plugins, ctx);
    await stepService.resolveSkillsAndToolsAsync('turn-2', plugins, ctx);

    expect(chatSkillService.resolveSkillsForTurnAsync).toHaveBeenCalledTimes(2);
  });
});

describe('SendTurnStepService title generation policy', () => {
  it('does not pass llmService for first two human turns, then enables it on the third', async () => {
    const sessionManager = {
      appendMessage: vi.fn(async () => null),
    } as any;

    const { stepService, llmService } = createStepService({ sessionManager });
    const ctx = {
      agent: { id: 'agent-1' },
      sessionId: 'session-1',
      history: [],
    } as unknown as ExecutionContext;

    await stepService.persistUserMessageAsync('turn 1', ctx);
    await stepService.persistUserMessageAsync('turn 2', ctx);
    await stepService.persistUserMessageAsync('turn 3', ctx);

    expect(sessionManager.appendMessage).toHaveBeenCalledTimes(3);
    expect(sessionManager.appendMessage.mock.calls[0][2]).toBeUndefined();
    expect(sessionManager.appendMessage.mock.calls[1][2]).toBeUndefined();
    expect(sessionManager.appendMessage.mock.calls[2][2]).toBe(llmService);
  });

  it('enables assistant-message title generation only when at least 3 human turns exist', async () => {
    const sessionManager = {
      appendMessage: vi.fn(async () => null),
    } as any;

    const { stepService, llmService } = createStepService({ sessionManager });
    const ctx = {
      agent: { id: 'agent-1' },
      sessionId: 'session-1',
      history: [
        { isHuman: true, content: 'one' },
        { isHuman: true, content: 'two' },
        { isHuman: true, content: 'three' },
      ],
    } as unknown as ExecutionContext;

    await stepService.persistAssistantMessageAsync('assistant reply', ctx);

    expect(sessionManager.appendMessage).toHaveBeenCalledOnce();
    expect(sessionManager.appendMessage.mock.calls[0][2]).toBe(llmService);
  });
});
