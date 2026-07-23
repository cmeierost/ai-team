import { describe, expect, it, vi } from 'vitest';
import {
  CORE_SERVICE_TOKENS,
  type IBackendLogService,
  type IServiceContainer,
} from '@ai-team/core';
import { WorkflowRunner } from '../xstate-workflow-runner.js';
import { CommandChatRuntime } from './command-chat-runtime.js';

const backendLog: IBackendLogService = { write: () => {} };

function workflowRunner() {
  const container = {
    resolve: (token: unknown) => {
      if (token === CORE_SERVICE_TOKENS.ToolManager) return { get: () => undefined };
      if (token === CORE_SERVICE_TOKENS.BackendLogService) return backendLog;
      throw new Error(`Unexpected token: ${String(token)}`);
    },
    tryResolve: () => undefined,
    has: () => false,
    child() {
      return this;
    },
  } as unknown as IServiceContainer;
  return new WorkflowRunner(container, backendLog);
}

describe('CommandChatRuntime', () => {
  it('continues an already-applied tool handoff without dispatching it twice', async () => {
    const dispatch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'ok',
        data: {
          text: '',
          followUpMessage: '[internal acknowledgement]',
          agentId: 'emily-davis',
          sessionId: 'session-emily',
        },
      })
      .mockResolvedValueOnce({
        status: 'ok',
        data: {
          text: 'Hello from Emily.',
          agentId: 'emily-davis',
          sessionId: 'session-emily',
        },
      });
    const runtime = new CommandChatRuntime(
      { dispatch } as any,
      { create: workflowRunner } as any
    );

    const result = await runtime.runAsync({
      message: 'Let me talk to Emily.',
      agentId: 'michael-brown',
      sessionId: 'session-michael',
      invocationSurface: 'cli',
      calledByHuman: true,
    });

    expect(result).toMatchObject({
      status: 'completed',
      text: 'Hello from Emily.',
      hopCount: 1,
    });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls.map(([command]) => command)).toEqual([
      'chat-chat-direct-turn',
      'chat-chat-direct-turn',
    ]);
    expect(dispatch.mock.calls[1]?.[1]).toMatchObject({
      agentId: 'emily-davis',
      options: {
        messageOrigin: 'internal',
        sessionId: 'session-emily',
      },
    });
  });

  it('uses the same com-handoff transition for a requested workflow handoff', async () => {
    const dispatch = vi.fn(async (command: string, payload: any) => {
      if (command === 'com-handoff') {
        return {
          status: 'ok',
          data: {
            type: 'handoff',
            targetAgentId: 'emily-davis',
            targetSessionId: 'session-emily',
          },
        };
      }
      if (payload.options.messageOrigin === 'internal') {
        return {
          status: 'ok',
          data: {
            text: 'Hello from Emily.',
            agentId: 'emily-davis',
            sessionId: 'session-emily',
          },
        };
      }
      return {
        status: 'ok',
        data: {
          text: '',
          handoffTargetId: 'emily-davis',
          handoffNote: 'Continue the workflow.',
          agentId: 'michael-brown',
          sessionId: 'session-michael',
        },
      };
    });
    const runtime = new CommandChatRuntime(
      { dispatch } as any,
      { create: workflowRunner } as any
    );

    const result = await runtime.runAsync({
      message: 'workflow handoff',
      agentId: 'michael-brown',
      sessionId: 'session-michael',
      invocationSurface: 'workflow',
    });

    expect(result.text).toBe('Hello from Emily.');
    expect(dispatch.mock.calls.filter(([command]) => command === 'com-handoff')).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith(
      'com-handoff',
      expect.objectContaining({
        targetAgentId: 'emily-davis',
        briefingNote: 'Continue the workflow.',
      }),
      expect.objectContaining({
        agentId: 'michael-brown',
        sessionId: 'session-michael',
        invocationSurface: 'workflow',
      })
    );
  });

  it('keeps the completed target transition authoritative when acknowledgement fails', async () => {
    let active = {
      agentId: 'michael-brown',
      sessionId: 'session-michael',
    };
    const dispatch = vi.fn(async (command: string, payload: any) => {
      if (command === 'com-handoff') {
        active = { agentId: 'emily-davis', sessionId: 'session-emily' };
        return {
          status: 'ok',
          data: {
            type: 'handoff',
            targetAgentId: active.agentId,
            targetSessionId: active.sessionId,
          },
        };
      }
      if (payload.options.messageOrigin === 'internal') {
        expect(payload).toMatchObject({
          agentId: active.agentId,
          options: { sessionId: active.sessionId },
        });
        return { status: 'error', message: 'target acknowledgement failed' };
      }
      return {
        status: 'ok',
        data: {
          text: '',
          handoffTargetId: 'emily-davis',
          agentId: 'michael-brown',
          sessionId: 'session-michael',
        },
      };
    });
    const runtime = new CommandChatRuntime(
      { dispatch } as any,
      { create: workflowRunner } as any
    );

    const result = await runtime.runAsync({
      message: 'handoff',
      agentId: 'michael-brown',
      sessionId: 'session-michael',
      invocationSurface: 'workflow',
    });

    expect(result).toMatchObject({
      status: 'failed',
      error: expect.any(String),
    });
    expect(active).toEqual({
      agentId: 'emily-davis',
      sessionId: 'session-emily',
    });
  });
});
