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
      buildToolDefinitionsFromDescriptors: vi.fn((tools: any[]) =>
        tools.map((t) => ({ name: `${t.group}_${t.key}` }))
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
      'Ordinary messages with the user role are authored by Clemens Meier'
    );
    expect(messages[0]?.content).toContain('The explicit exception is an "[Internal handoff —"');
    expect(messages[0]?.content).toContain('usually use their first name, Clemens');
    expect(messages[0]?.content).toContain('address Clemens Meier directly');
    expect(messages[0]?.content).toContain(
      'translate third-person wording such as "Clemens wants" into "you want"'
    );
    expect(messages[0]?.content).toContain('Use session_return only after');
    expect(messages[0]?.content).toContain(
      'developer clearly asks to return/report back'
    );
    expect(messages[0]?.content).toContain(
      'Do not return merely because you answered the current question'
    );
    expect(messages[0]?.content).toContain(
      'the receiving agent’s responsibility and expected first action'
    );
    expect(messages[1]).toEqual({ role: 'user', content: "what's up today?" });
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
      buildToolDefinitionsFromDescriptors: vi.fn((tools: any[]) =>
        tools.map((tool) => ({ name: `${tool.group}_${tool.key}` }))
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
      commandDispatcher: {
        getCommands: vi.fn(() => []),
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
      commandDispatcher: { getCommands: vi.fn(() => []) },
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

  it('adds workflow descriptors from the command catalog without resolving workflow commands', async () => {
    const agent = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      tools: ['fs_*'],
      disallowedTools: [],
    } as unknown as Agent;
    const ctx = {
      agent,
      workspaceRoot: '/workspace',
      sessionId: 'session-1',
      history: [],
    } as unknown as ExecutionContext;
    const plugins = {
      toolResolver: { resolve: vi.fn(async () => [makeTool('fs_read')]) },
      mcpGateway: { discover: vi.fn(async () => []) },
      llmSelector: { select: vi.fn(async () => undefined) },
      commandDispatcher: {
        getCommands: vi.fn(() => [
          { key: 'list', group: 'workflow', description: 'List workflows', availableIn: { tool: true } },
          {
            key: 'onboarding',
            group: 'workflow',
            description: 'Run onboarding workflow',
            availableIn: { tool: true },
          },
        ]),
      },
    } as any;
    const toolSchemaService = {
      buildToolDefinitions: vi.fn((tools: any[]) =>
        tools.map((tool) => ({ name: `${tool.metadata.group}_${tool.metadata.key}` }))
      ),
      buildToolDefinitionsFromDescriptors: vi.fn((descriptors: any[]) =>
        descriptors.map((descriptor) => ({ name: `${descriptor.group}_${descriptor.key}` }))
      ),
    } as any;

    const { stepService } = createStepService({
      chatSkillService: {
        resolveSkillsForTurnAsync: vi.fn(async () => ({ skills: [] })),
      } as any,
      agentManager: {
        getAllAgentsAsync: vi.fn(async () => [agent]),
        recordInteractionAsync: vi.fn(async () => undefined),
      } as any,
      toolSchemaService,
    });
    const resolved = await stepService.resolveSkillsAndToolsAsync('start onboarding', plugins, ctx);

    expect(resolved.toolDefs.map((tool) => tool.name)).toEqual(['fs_read', 'workflow_onboarding']);
    expect(toolSchemaService.buildToolDefinitionsFromDescriptors).toHaveBeenCalledWith([
      { key: 'onboarding', group: 'workflow', description: 'Run onboarding workflow' },
    ]);
  });

  it('does not duplicate workflow tools already exposed as command tool definitions', async () => {
    const agent = {
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      tools: ['workflow_*'],
      disallowedTools: [],
    } as unknown as Agent;
    const ctx = {
      agent,
      workspaceRoot: '/workspace',
      sessionId: 'session-1',
      history: [],
    } as unknown as ExecutionContext;
    const onboardingTool = makeTool('workflow_onboarding');
    const plugins = {
      toolResolver: { resolve: vi.fn(async () => [onboardingTool]) },
      mcpGateway: { discover: vi.fn(async () => []) },
      llmSelector: { select: vi.fn(async () => undefined) },
      commandDispatcher: {
        getCommands: vi.fn(() => [
          {
            key: 'onboarding',
            group: 'workflow',
            description: 'Run onboarding workflow',
            availableIn: { tool: true },
          },
        ]),
      },
    } as any;

    const { stepService } = createStepService({
      chatSkillService: {
        resolveSkillsForTurnAsync: vi.fn(async () => ({ skills: [] })),
      } as any,
      agentManager: {
        getAllAgentsAsync: vi.fn(async () => [agent]),
        recordInteractionAsync: vi.fn(async () => undefined),
      } as any,
      toolSchemaService: {
        buildToolDefinitions: vi.fn(() => [{ name: 'workflow_onboarding' }]),
        buildToolDefinitionsFromDescriptors: vi.fn(() => [{ name: 'workflow_onboarding' }]),
      } as any,
    });

    const resolved = await stepService.resolveSkillsAndToolsAsync('start onboarding', plugins, ctx);
    expect(resolved.toolDefs.map((tool) => tool.name)).toEqual(['workflow_onboarding']);
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

describe('SendTurnStepService.handleLlmFailureAsync', () => {
  it('emits the persisted fallback message and its technical details for live chat', async () => {
    const emitService = { log: vi.fn(), emit: vi.fn(), status: vi.fn() } as any;
    const { stepService, sessionManager } = createStepService({ emitService });
    const ctx = {
      agent: { id: 'sarah-lee' },
      sessionId: 'session-1',
      history: [],
    } as unknown as ExecutionContext;
    const plugins = { outputHandler: { handle: vi.fn(async () => undefined) } } as any;

    const result = await stepService.handleLlmFailureAsync(
      new Error('LLM returned an empty response'),
      plugins,
      ctx
    );

    expect(result.text).toBe(
      'Sorry — I ran into a temporary issue while processing your request. Please try again.'
    );
    expect(emitService.status).toHaveBeenCalledWith(
      'error',
      'Sorry — I ran into a temporary issue while processing your request. Please try again.\n\nDetails: LLM returned an empty response'
    );
    expect(sessionManager.appendMessage).toHaveBeenCalledOnce();
  });
});
