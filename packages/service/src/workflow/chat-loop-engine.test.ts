import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { Agent, ICommand, IServiceContainer } from '@ai-team/core';
import { ContextLevel } from '@ai-team/core';

import { ToolManager } from '../tools/tool-manager.js';
import { CommandRegistry } from '../command-registry-impl.js';
import {
  WORKFLOW_ENGINE_TOKENS,
  getChatLoopWorkflowDefinitionJson,
  getChatLoopWorkflowDefinitionYaml,
  runChatLoopWorkflowAsync,
  type ChatLoopToolRoundExecutionRequest,
  type ChatLoopWorkflowServices,
} from './chat-loop-engine.js';

function createAgent(): Agent {
  return {
    id: 'emily-davis',
    name: 'Emily Davis',
    filePath: '/workspace/.ai-team/agents/emily-davis.agent.md',
    skillPath: '/workspace/.ai-team/skills/frontend-web-delivery/SKILL.md',
    createdAt: new Date().toISOString(),
    role: 'frontend-developer',
    systemPrompt: 'You are Emily',
    contextLevel: ContextLevel.FEATURE,
    tools: ['fs_*'],
  };
}

function createBaseServices(
  overrides?: Partial<ChatLoopWorkflowServices>
): ChatLoopWorkflowServices {
  return {
    runPreturnInterceptorsAsync: async () => ({ outcome: 'continue' }),
    runSendTurnAsync: async () => ({ text: 'Done', toolRoundNeeded: false }),
    runPostTurnResolutionAsync: async () => ({ outcome: 'normal_complete' }),
    runHandoffTransitionAsync: async () => ({}),
    ...overrides,
  };
}

describe('xstate-chat-loop-engine', () => {
  it('exports a YAML-compatible JSON definition for chat loop states', () => {
    const definition = getChatLoopWorkflowDefinitionJson();

    expect(definition.format).toBe('workflow/v1');
    expect(definition.id).toBe('chat-full-loop');
    expect(definition.initial).toBe('preturn');

    expect(Object.keys(definition.states)).toEqual(
      expect.arrayContaining([
        'preturn',
        'routeAfterPreturn',
        'sendTurn',
        'routeAfterSendTurn',
        'toolRound',
        'postTurnResolution',
        'routeAfterPostTurn',
        'handoffTransition',
        'failure',
        'completed',
        'maxHopsReached',
        'failed',
      ])
    );
  });

  it('includes transition and invoke metadata needed for diagram rendering', () => {
    const definition = getChatLoopWorkflowDefinitionJson();

    expect(definition.states.preturn.invoke?.src).toBe('runPreturnInterceptors');
    expect(definition.states.sendTurn.invoke?.src).toBe('runSendTurn');

    expect(definition.states.routeAfterPreturn.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'always', target: 'completed', guard: 'preturnConsumed' }),
        expect.objectContaining({
          event: 'always',
          target: 'prepareForwardedAutoReact',
          guard: 'preturnForwarded',
        }),
        expect.objectContaining({ event: 'always', target: 'sendTurn' }),
      ])
    );

    expect(definition.states.routeAfterPostTurn.transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'always',
          target: 'maxHopsReached',
          guard: 'postTurnHandoffMaxHopsReached',
        }),
        expect.objectContaining({
          event: 'always',
          target: 'handoffTransition',
          guard: 'postTurnHandoffRequired',
        }),
      ])
    );
  });

  it('exports chat loop definition as YAML', () => {
    const yaml = getChatLoopWorkflowDefinitionYaml();

    expect(yaml).toContain('format: workflow/v1');
    expect(yaml).toContain('id: chat-full-loop');
    expect(yaml).toContain('initial: preturn');
    expect(yaml).toContain('states:');
    expect(yaml).toContain('preturn:');
    expect(yaml).toContain('routeAfterPostTurn:');
  });

  it('completes normal loop without tool round', async () => {
    const output = await runChatLoopWorkflowAsync(
      { message: 'hello' },
      createBaseServices({
        runSendTurnAsync: async () => ({ text: 'All good', toolRoundNeeded: false }),
      })
    );

    expect(output).toEqual({
      status: 'completed',
      text: 'All good',
      hopCount: 0,
    });
  });

  it('uses ToolManager registry first for tool round execution', async () => {
    const registry = new CommandRegistry();
    const toolManager = new ToolManager(
      '/workspace',
      {
        canReadPath: () => true,
        canWritePath: () => true,
        canListPath: () => true,
        assertCanReadPath: () => undefined,
        assertCanWritePath: () => undefined,
      },
      registry,
      { resolve: () => undefined } as any
    );
    const executeSpy = vi.fn(async () => ({ ok: true }));
    const readMeta = {
      key: 'read',
      group: 'fs',
      availableIn: { tool: true, cli: false, chat: false },
      description: 'Read file',
      parameters: z.object({ filePath: z.string() }),
      permissionCheck: { type: 'none' as const },
    };
    registry.register(readMeta, () => ({ metadata: readMeta, execute: executeSpy }) as ICommand);

    const services = createBaseServices({
      runSendTurnAsync: async () => ({
        text: 'Need tool execution',
        toolRoundNeeded: true,
        pendingToolCall: {
          toolName: 'fs_read',
          args: { filePath: 'README.md' },
        },
      }),
      runPostTurnResolutionAsync: async ({ text }) => {
        expect(text).toBe('Need tool execution');
        return { outcome: 'normal_complete' };
      },
    });

    const output = await runChatLoopWorkflowAsync({ message: 'run tool' }, services, {
      tooling: {
        agent: createAgent(),
        toolManager,
        toolContext: {
          workspaceRoot: '/workspace',
        } as any,
      },
    });

    expect(output.status).toBe('completed');
    expect(executeSpy).toHaveBeenCalledOnce();
  });

  it('falls back to DI container executor when tool is not in registry', async () => {
    const fallbackExecutor = {
      executeAsync: vi.fn(async (_request: ChatLoopToolRoundExecutionRequest) => ({
        outcome: 'tool_complete' as const,
      })),
    };

    const resolver = {
      tryResolve: (token: { id: string }) => {
        if (token.id === WORKFLOW_ENGINE_TOKENS.ChatLoopToolRoundExecutor.id) {
          return fallbackExecutor;
        }
        return undefined;
      },
    } as IServiceContainer;

    const services = createBaseServices({
      runSendTurnAsync: async () => ({
        text: 'Need custom tool execution',
        toolRoundNeeded: true,
        pendingToolCall: {
          toolName: 'custom_tool',
          args: { anything: true },
        },
      }),
    });

    const output = await runChatLoopWorkflowAsync({ message: 'run custom tool' }, services, {
      tooling: {
        agent: createAgent(),
        toolManager: new ToolManager(
          '/workspace',
          {
            canReadPath: () => true,
            canWritePath: () => true,
            canListPath: () => true,
            assertCanReadPath: () => undefined,
            assertCanWritePath: () => undefined,
          },
          {
            register: () => undefined,
            get: () => undefined,
            getAll: () => [],
            toLlmToolDefinitions: () => [],
          } as any,
          { resolve: () => undefined } as any
        ),
        toolContext: {
          workspaceRoot: '/workspace',
        } as any,
        resolver,
      },
    });

    expect(output.status).toBe('completed');
    expect(fallbackExecutor.executeAsync).toHaveBeenCalledOnce();
  });

  it('fails when post-turn output violates no-hire contract', async () => {
    const failureSpy = vi.fn();

    const output = await runChatLoopWorkflowAsync(
      { message: 'bad post turn' },
      createBaseServices({
        runPostTurnResolutionAsync: async () => ({ outcome: 'hire_complete' }) as any,
        runFailureAsync: async (failure) => {
          failureSpy(failure);
        },
      })
    );

    expect(output.status).toBe('failed');
    expect(output.error).toContain('Invalid');
    expect(failureSpy).toHaveBeenCalledOnce();
  });

  it('stops at max hops for repeated handoff requirements', async () => {
    const sendTurnSpy = vi.fn(async ({ hop }: { hop: number }) => ({
      text: `hop-${hop}`,
      toolRoundNeeded: false,
    }));
    const handoffSpy = vi.fn(async () => ({ autoMessage: 'handoff auto react' }));

    const output = await runChatLoopWorkflowAsync(
      { message: 'start', maxHops: 1 },
      createBaseServices({
        runSendTurnAsync: sendTurnSpy,
        runPostTurnResolutionAsync: async () => ({
          outcome: 'handoff_required',
          handoffTargetId: 'target',
        }),
        runHandoffTransitionAsync: handoffSpy,
      })
    );

    expect(output.status).toBe('max_hops_reached');
    expect(output.hopCount).toBe(1);
    expect(handoffSpy).toHaveBeenCalledTimes(1);
    expect(sendTurnSpy).toHaveBeenCalledTimes(2);
  });
});
