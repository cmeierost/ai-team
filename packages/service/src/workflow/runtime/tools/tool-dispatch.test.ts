import type { ExecutionContext, ILlmService } from '@ai-team/core';
import { describe, expect, it, vi } from 'vitest';
import { ToolDispatcher } from './tool-dispatch.js';
import { ToolDispatchSupportService } from './tool-dispatch-support-service.js';
import { ToolSerializationService } from './tool-serialization-service.js';
import type { IQuestionService } from '../../../interaction/question-service.js';
import { EmitService } from '../../../interaction/emit-service.js';

// Module-level capture used by createEmitService → createDispatcher to thread
// the per-test emit mock into ToolDispatcher without touching every call site.
let _testEmitFn: (event: unknown) => void = () => {};

function makeContext(overrides?: Partial<ExecutionContext>): ExecutionContext {
  const base: ExecutionContext = {
    agent: { id: 'agent-a', name: 'Agent A', role: 'dev', systemPrompt: '' } as any,
    sessionId: 'sess-1',
    history: [],
  };

  return { ...base, ...overrides };
}

function createDispatcher(
  toolManager: any,
  sessionManager: any,
  llmService: ILlmService,
  questionService = makeQuestionService({
    input: vi.fn(async () => ''),
    confirm: vi.fn(async () => true),
    select: vi.fn(async () => ''),
    password: vi.fn(async () => ''),
    checklist: vi.fn(async () => []),
  })
) {
  const serialization = new ToolSerializationService();
  const support = new ToolDispatchSupportService('c:/workspace', serialization, llmService, {
    create: () => ({ save: vi.fn() }),
  } as any);
  const emitService = new EmitService(_testEmitFn);
  return new ToolDispatcher(toolManager, sessionManager, support, questionService, emitService);
}

function makeQuestionService(overrides: Partial<IQuestionService>): IQuestionService {
  return {
    input: vi.fn(async () => ''),
    confirm: vi.fn(async () => true),
    select: vi.fn(async () => ''),
    password: vi.fn(async () => ''),
    checklist: vi.fn(async () => []),
    ...overrides,
  };
}

function createEmitService(emit: (event: any) => void) {
  _testEmitFn = emit;
  new EmitService(emit);
}

describe('dispatchToolCall denial metadata', () => {
  it('passes command response data to the LLM formatter', async () => {
    const formatForLlm = vi.fn((result: any) => result.results.join(', '));
    const commandResponse = {
      status: 'ok',
      data: { results: ['orchestrator.ts'] },
    };
    const toolManager = {
      get: vi.fn(() => ({ metadata: {}, formatForLlm })),
      execute: vi.fn(async () => ({ ok: true, result: commandResponse })),
    } as any;
    const sessionManager = {
      appendToolCallRequest: vi.fn(async () => undefined),
      appendToolCallResult: vi.fn(async () => undefined),
    } as any;
    createEmitService(vi.fn());
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    const response = await dispatcher.dispatch(
      {
        toolCallId: 'tc-command-response-format',
        toolName: 'fs_search',
        args: { query: 'orchestrator', mode: 'names', maxResults: 10 },
      },
      makeContext()
    );

    expect(formatForLlm).toHaveBeenCalledWith(commandResponse.data);
    expect(response.result).toBe('orchestrator.ts');
    expect(sessionManager.appendToolCallResult).toHaveBeenCalledWith(
      'sess-1',
      'tc-command-response-format',
      commandResponse,
      'orchestrator.ts',
      'result',
      expect.any(String)
    );
  });

  it('emits ordered request/start/result lifecycle events with stable toolCallId', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({ ok: true, result: { ok: true } })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext({ history: [] });
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-order-1',
        toolName: 'tool_list',
        args: { includeHidden: false },
      },
      ctx
    );

    const phases = emit.mock.calls
      .map((call) => call[0])
      .filter((event) => event?.kind === 'tool' && event?.toolName === 'tool_list')
      .map((event) => ({
        phase: event.toolPhase,
        toolCallId: event.toolCallId,
      }));

    expect(phases).toEqual([
      { phase: 'request', toolCallId: 'tc-order-1' },
      { phase: 'start', toolCallId: 'tc-order-1' },
      { phase: 'result', toolCallId: 'tc-order-1' },
    ]);
    expect(toolManager.execute).toHaveBeenCalledWith(
      expect.anything(),
      'tool_list',
      { includeHidden: false },
      expect.objectContaining({
        commandInvocation: {
          callId: 'tc-order-1',
          toolName: 'tool_list',
        },
      }),
      expect.anything()
    );
  });

  it('persists the request before execution and the result as a separate completion', async () => {
    const order: string[] = [];
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => {
        order.push('execute');
        return { ok: true, result: { status: 'ok' } };
      }),
    } as any;
    const sessionManager = {
      appendToolCallRequest: vi.fn(async () => {
        order.push('request');
      }),
      appendToolCallResult: vi.fn(async () => {
        order.push('result');
      }),
      appendMessage: vi.fn(async () => {
        order.push('legacy');
      }),
    } as any;
    createEmitService(vi.fn());
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-split-1',
        toolName: 'tool_list',
        args: { includeHidden: false },
      },
      makeContext()
    );

    expect(order).toEqual(['request', 'execute', 'result']);
    expect(sessionManager.appendToolCallRequest).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({
        tool_calls: [
          expect.objectContaining({
            callId: 'tc-split-1',
            tool: 'tool_list',
            params: { includeHidden: false },
          }),
        ],
      })
    );
    expect(sessionManager.appendToolCallResult).toHaveBeenCalledWith(
      'sess-1',
      'tc-split-1',
      { status: 'ok' },
      undefined,
      'result',
      expect.any(String)
    );
    expect(sessionManager.appendMessage).not.toHaveBeenCalled();
  });

  it('uses extended timeout for com_ask interactive tool calls', async () => {
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true } }));
    const toolManager = {
      get: vi.fn(() => undefined),
      execute,
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-ask-timeout',
        toolName: 'com_ask',
        args: { kind: 'input', message: 'Question?' },
      },
      ctx
    );

    const executionOptions = (execute.mock.calls[0] as any[])?.[4] as
      | { timeoutMs?: number }
      | undefined;
    expect(executionOptions?.timeoutMs).toBe(15 * 60 * 1000);
  });

  it('passes through tool execution context without question handlers', async () => {
    const execute = vi.fn(async () => ({ ok: true, result: { ok: true } }));
    const toolManager = {
      get: vi.fn(() => undefined),
      execute,
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-bridges',
        toolName: 'tool_list',
        args: {},
      },
      ctx
    );

    const executionContext = (execute.mock.calls[0] as any[])?.[3];
    expect(executionContext).toEqual(
      expect.objectContaining({
        sessionId: 'sess-1',
        history: [],
        workspaceRoot: 'c:/workspace',
        currentFiles: undefined,
      })
    );
  });

  it('passes workflow metadata to tools and isolates parent context from tool mutations', async () => {
    let receivedContext: any;
    const execute = vi.fn(async (_agent: any, _toolName: string, _args: unknown, toolCtx: any) => {
      receivedContext = {
        ...toolCtx,
        history: Array.isArray(toolCtx.history) ? [...toolCtx.history] : toolCtx.history,
      };
      toolCtx.workflowId = 'mutated-in-tool';
      toolCtx.sessionId = 'mutated-session';
      if (Array.isArray(toolCtx.history)) {
        toolCtx.history.push({ content: 'mutated' });
      }
      return { ok: true, result: { ok: true } };
    });
    const toolManager = {
      get: vi.fn(() => undefined),
      execute,
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const parentCtx = makeContext({
      workflowId: 'parent-workflow',
      workflowInstanceId: 'wf-1',
      stepId: 'toolRound',
      subworkflowDepth: 2,
      history: [],
    });
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-parent-restore',
        toolName: 'tool_list',
        args: {},
      },
      parentCtx
    );

    expect(receivedContext).toEqual(
      expect.objectContaining({
        sessionId: 'sess-1',
        workflowId: 'parent-workflow',
        workflowInstanceId: 'wf-1',
        stepId: 'toolRound',
        subworkflowDepth: 2,
      })
    );

    // Parent context remains untouched after tool execution.
    expect(parentCtx.workflowId).toBe('parent-workflow');
    expect(parentCtx.sessionId).toBe('sess-1');
    expect(parentCtx.history).toEqual([]);
  });

  it.each(['com_handoff', 'session_return'])(
    'persists a %s transition result in the source session before adopting the target context',
    async (transitionTool) => {
      const toolManager = {
        get: vi.fn(() => undefined),
        execute: vi.fn(async (_agent: unknown, _name: string, _args: unknown, toolCtx: any) => {
          toolCtx.agent = {
            id: 'agent-b',
            name: 'Agent B',
            role: 'dev',
            systemPrompt: '',
          };
          toolCtx.agentId = 'agent-b';
          toolCtx.sessionId = 'sess-2';
          toolCtx.history = [];
          return {
            ok: true,
            result: {
              type: 'handoff',
              targetAgentId: 'agent-b',
              targetSessionId: 'sess-2',
              timestamp: new Date().toISOString(),
            },
          };
        }),
      } as any;
      const appendMessage = vi.fn(async () => undefined);
      const ctx = makeContext();
      createEmitService(vi.fn());
      const dispatcher = createDispatcher(
        toolManager,
        { appendMessage } as any,
        {} as any
      );

      const response = await dispatcher.dispatch(
        {
          toolCallId: 'tc-handoff',
          toolName: transitionTool,
          args: { targetAgentId: 'agent-b' },
        },
        ctx
      );

      expect(appendMessage).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          from: 'agent-a',
          tool_calls: [
            expect.objectContaining({
              tool: transitionTool,
            }),
          ],
        })
      );
      expect(ctx).toMatchObject({
        agentId: 'agent-b',
        sessionId: 'sess-2',
      });
      expect(response.terminal).toBe(true);
    }
  );

  it('emits tool result event with a preview of successful output', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({
        ok: true,
        result: {
          tools: ['tool_list', 'fs_read'],
          count: 2,
        },
      })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-preview',
        toolName: 'tool_list',
        args: {},
      },
      ctx
    );

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'tool_list',
        toolPhase: 'result',
        message: expect.stringContaining('"tools": ['),
        toolResult: expect.objectContaining({
          toolName: 'tool_list',
          outcome: 'result',
        }),
      })
    );
  });

  it('truncates long successful tool result previews', async () => {
    const longText = 'x'.repeat(400);
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({ ok: true, result: longText })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-preview-long',
        toolName: 'tool_list',
        args: {},
      },
      ctx
    );

    const resultEvent = emit.mock.calls
      .map((call) => call[0])
      .find(
        (event) =>
          event?.kind === 'tool' && event?.toolPhase === 'result' && event?.toolName === 'tool_list'
      );

    expect(typeof resultEvent?.message).toBe('string');
    expect(resultEvent?.message.length).toBeLessThanOrEqual(220);
    expect(resultEvent?.message.endsWith('…')).toBe(true);
  });

  it('does not truncate JSON tool result previews', async () => {
    const payload = {
      type: 'tool_list_result',
      entries: Array.from({ length: 40 }, (_, idx) => ({
        name: `tool_${idx + 1}`,
        description: 'x'.repeat(24),
      })),
    };

    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({ ok: true, result: payload })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-preview-json',
        toolName: 'tool_list',
        args: {},
      },
      ctx
    );

    const resultEvent = emit.mock.calls
      .map((call) => call[0])
      .find(
        (event) =>
          event?.kind === 'tool' && event?.toolPhase === 'result' && event?.toolName === 'tool_list'
      );

    expect(resultEvent?.message).toBe(JSON.stringify(payload, null, 2));
    expect((resultEvent?.message as string).length).toBeGreaterThan(220);
  });

  it('returns user-denied metadata when confirmation is rejected', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({ ok: true, result: { never: 'called' } })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext({});
    const emit = vi.fn();
    createEmitService(emit);
    const questionService = makeQuestionService({
      input: vi.fn(async () => ''),
      confirm: vi.fn(async () => false),
      select: vi.fn(async () => ''),
      password: vi.fn(async () => ''),
      checklist: vi.fn(async () => []),
    });
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any, questionService);

    const result = await dispatcher.dispatch(
      {
        toolCallId: 'tc-1',
        toolName: 'fs_write_file',
        args: { filePath: 'a.ts', content: 'x' },
      },
      ctx
    );

    expect(toolManager.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.denial).toBeDefined();
    expect(result.denial?.kind).toBe('user-denied');
    expect(result.denial?.reasonCode).toBe('user_declined');

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'fs_write_file',
        toolPhase: 'denied',
        toolDenial: expect.objectContaining({
          kind: 'user-denied',
          reasonCode: 'user_declined',
        }),
      })
    );
  });

  it('returns policy-denied metadata from permission_denied tool result', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({
        ok: true,
        result: {
          status: 'permission_denied',
          message: 'Agent cannot write requested file.',
          blockedFiles: [{ filePath: 'src/secret.ts', reason: 'scope mismatch' }],
          access: {
            allowed: false,
            alternativeContexts: [{ contextId: 'agent-infra', allowedPaths: ['src/secret.ts'] }],
          },
        },
      })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    const result = await dispatcher.dispatch(
      {
        toolCallId: 'tc-2',
        toolName: 'fs_read',
        args: { filePath: 'src/secret.ts' },
      },
      ctx
    );

    expect(result.isError).toBe(false);
    expect(result.denial).toBeDefined();
    expect(result.denial?.kind).toBe('policy-denied');
    expect(result.denial?.reasonCode).toBe('permission_denied');
    expect(result.denial?.blockedPaths).toEqual(['src/secret.ts']);
    expect(result.denial?.handoffRecommendation).toEqual({
      possible: true,
      requiresUserApproval: true,
      contexts: [{ contextId: 'agent-infra', allowedPaths: ['src/secret.ts'] }],
    });

    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'fs_read',
        toolPhase: 'denied',
        toolDenial: expect.objectContaining({
          kind: 'policy-denied',
          reasonCode: 'permission_denied',
          blockedPaths: ['src/secret.ts'],
        }),
      })
    );
  });

  it('returns execution-failed metadata when tool execution fails', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({ ok: false, error: 'Boom' })),
    } as any;

    const appendMessage = vi.fn(async () => undefined);
    const sessionManager = { appendMessage } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    const result = await dispatcher.dispatch(
      {
        toolCallId: 'tc-3',
        toolName: 'fs_read',
        args: { filePath: 'src/a.ts' },
      },
      ctx
    );

    expect(result.isError).toBe(true);
    expect(result.denial).toBeDefined();
    expect(result.denial?.kind).toBe('execution-failed');
    expect(result.denial?.reasonCode).toBe('tool_execution_failed');

    const firstCall = (appendMessage.mock.calls[0] ?? []) as any[];
    const persisted = firstCall[1] as {
      content?: string;
      tool_calls?: Array<{ result?: unknown; resultLlm?: string }>;
    };
    expect(persisted.content).toBe('');
    expect(persisted.tool_calls?.[0]?.resultLlm).toBe('Boom');
    expect(persisted.tool_calls?.[0]?.result).toEqual(
      expect.objectContaining({
        status: 'error',
        message: 'Boom',
        denial: expect.objectContaining({
          kind: 'execution-failed',
          reasonCode: 'tool_execution_failed',
        }),
      })
    );
  });

  it('keeps tool output out of message.content while preserving tool_calls payload', async () => {
    const large = Array.from({ length: 260 }, (_, idx) => `line-${idx + 1}`).join('\n');
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({ ok: true, result: large })),
    } as any;

    const appendMessage = vi.fn(async () => undefined);
    const sessionManager = { appendMessage } as any;
    const ctx = makeContext({
      history: [
        {
          timestamp: new Date().toISOString(),
          from: 'human',
          isHuman: true,
          content: 'run tool please',
        } as any,
      ],
    });
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-auto-trim',
        toolName: 'tool_list',
        args: {},
      },
      ctx
    );

    const firstCall = (appendMessage.mock.calls[0] ?? []) as any[];
    const persisted = firstCall[1] as {
      content?: string;
      tool_calls?: Array<{ result?: unknown }>;
    };
    expect(persisted.content).toBe('');
    expect(typeof persisted.tool_calls?.[0]?.result).toBe('string');
    expect((persisted.tool_calls?.[0]?.result as string) || '').toContain('line-260');
  });

  it('persists JSON tool output in tool_calls only', async () => {
    const largeJson = {
      items: Array.from({ length: 260 }, (_, idx) => ({
        id: idx + 1,
        value: `entry-${idx + 1}`,
      })),
    };

    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({ ok: true, result: largeJson })),
    } as any;

    const appendMessage = vi.fn(async () => undefined);
    const sessionManager = { appendMessage } as any;
    const ctx = makeContext({
      history: [
        {
          timestamp: new Date().toISOString(),
          from: 'human',
          isHuman: true,
          content: 'run tool please',
        } as any,
      ],
    });
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-auto-json',
        toolName: 'tool_list',
        args: {},
      },
      ctx
    );

    const firstCall = (appendMessage.mock.calls[0] ?? []) as any[];
    const persisted = firstCall[1] as {
      content?: string;
      tool_calls?: Array<{ result?: unknown }>;
    };
    expect(persisted.content).toBe('');
    const items =
      (persisted.tool_calls?.[0]?.result as { items?: Array<{ id: number }> })?.items ?? [];
    expect(items.at(-1)?.id).toBe(260);
  });

  it('does not invoke history summary transform for persisted tool-call rows', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({ ok: true, result: 'alpha\nbeta\ngamma' })),
    } as any;

    const appendMessage = vi.fn(async () => undefined);
    const rawChat = vi.fn(async () => '- key point A\n- key point B');
    const sessionManager = { appendMessage } as any;
    const ctx = makeContext({
      history: [
        {
          timestamp: new Date().toISOString(),
          from: 'human',
          isHuman: true,
          content: 'summarize the most important parts',
        } as any,
      ],
    });
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, { rawChat } as any);

    await dispatcher.dispatch(
      {
        toolCallId: 'tc-summary',
        toolName: 'tool_list',
        args: {},
      },
      ctx
    );

    expect(rawChat).not.toHaveBeenCalled();
    const firstCall = (appendMessage.mock.calls[0] ?? []) as any[];
    const persisted = firstCall[1] as {
      content?: string;
      tool_calls?: Array<{ result?: unknown }>;
    };
    expect(persisted.content).toBe('');
    expect(persisted.tool_calls?.[0]?.result).toBe('alpha\nbeta\ngamma');
  });
});

describe('code_edit_proposal emission', () => {
  it('emits code_edit_proposal for fs_write_file when result includes _fileChanges', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({
        ok: true,
        result: {
          path: 'src/new-file.ts',
          written: true,
          _fileChanges: [
            {
              filePath: '/ws/src/new-file.ts',
              oldContent: '',
              newContent: 'export const x = 1;\n',
            },
          ],
        },
      })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      { toolCallId: 'tc-write-file', toolName: 'fs_write_file', args: {} },
      ctx
    );
    const events = emit.mock.calls.map((c: any[]) => c[0]);
    const proposal = events.find((e: any) => e.kind === 'code_edit_proposal');

    expect(proposal).toBeDefined();
    expect(proposal.proposalId).toBe('fs_write_file-tc-write-file');
    expect(proposal.filesChanged).toBe(1);
    expect(proposal.files).toEqual([
      {
        filePath: '/ws/src/new-file.ts',
        oldContent: '',
        newContent: 'export const x = 1;\n',
        additions: 2,
        deletions: 0,
      },
    ]);
    const toolResultEvent = events.find(
      (event: any) => event.kind === 'tool' && event.toolPhase === 'result'
    );
    expect(toolResultEvent.toolResult.fileChanges).toEqual([
      {
        filePath: '/ws/src/new-file.ts',
        oldContent: '',
        newContent: 'export const x = 1;\n',
      },
    ]);
    expect(toolResultEvent.toolResult.commandResponse.data).not.toHaveProperty('_fileChanges');
  });

  it('emits code_edit_proposal when tool result contains _fileChanges', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({
        ok: true,
        result: {
          edited: true,
          _fileChanges: [
            { filePath: '/ws/app.ts', oldContent: 'const x = 1;', newContent: 'const x = 42;' },
          ],
        },
      })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch({ toolCallId: 'tc-diff-1', toolName: 'fs_edit', args: {} }, ctx);
    const events = emit.mock.calls.map((c: any[]) => c[0]);
    const proposal = events.find((e: any) => e.kind === 'code_edit_proposal');

    expect(proposal).toBeDefined();
    expect(proposal.proposalId).toBe('fs_edit-tc-diff-1');
    expect(proposal.agentName).toBe('Agent A');
    expect(proposal.filesChanged).toBe(1);
    expect(proposal.files).toEqual([
      {
        filePath: '/ws/app.ts',
        oldContent: 'const x = 1;',
        newContent: 'const x = 42;',
        additions: 1,
        deletions: 1,
      },
    ]);
  });

  it('emits code_edit_proposal with multiple files', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({
        ok: true,
        result: {
          edited: true,
          _fileChanges: [
            { filePath: '/ws/a.ts', oldContent: 'a1', newContent: 'a2' },
            { filePath: '/ws/b.ts', oldContent: 'b1', newContent: 'b2' },
          ],
        },
      })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch(
      { toolCallId: 'tc-diff-multi', toolName: 'multiedit', args: {} },
      ctx
    );
    const events = emit.mock.calls.map((c: any[]) => c[0]);
    const proposal = events.find((e: any) => e.kind === 'code_edit_proposal');

    expect(proposal).toBeDefined();
    expect(proposal.filesChanged).toBe(2);
    expect(proposal.files).toHaveLength(2);
  });

  it('does NOT emit code_edit_proposal when result has no _fileChanges', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({
        ok: true,
        result: { edited: true, message: 'done' },
      })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch({ toolCallId: 'tc-no-diff', toolName: 'fs_edit', args: {} }, ctx);
    const events = emit.mock.calls.map((c: any[]) => c[0]);
    const proposal = events.find((e: any) => e.kind === 'code_edit_proposal');

    expect(proposal).toBeUndefined();
  });

  it('does NOT emit code_edit_proposal when _fileChanges is empty', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({
        ok: true,
        result: { edited: true, _fileChanges: [] },
      })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch({ toolCallId: 'tc-empty-diff', toolName: 'fs_edit', args: {} }, ctx);
    const events = emit.mock.calls.map((c: any[]) => c[0]);
    const proposal = events.find((e: any) => e.kind === 'code_edit_proposal');

    expect(proposal).toBeUndefined();
  });

  it('strips _fileChanges from the result returned to the caller', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({
        ok: true,
        result: {
          edited: true,
          summary: 'replaced text',
          _fileChanges: [{ filePath: '/ws/c.ts', oldContent: 'old', newContent: 'new' }],
        },
      })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    const response = await dispatcher.dispatch(
      { toolCallId: 'tc-strip', toolName: 'fs_edit', args: {} },
      ctx
    );

    expect(response.result).not.toHaveProperty('_fileChanges');
    expect((response.result as any).edited).toBe(true);
    expect((response.result as any).summary).toBe('replaced text');
  });

  it('strips _fileChanges from persisted tool history', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({
        ok: true,
        result: {
          edited: true,
          _fileChanges: [{ filePath: '/ws/d.ts', oldContent: 'old', newContent: 'new' }],
        },
      })),
    } as any;

    const appendMessage = vi.fn(async () => undefined);
    const sessionManager = { appendMessage } as any;
    const ctx = makeContext({
      history: [
        {
          timestamp: new Date().toISOString(),
          from: 'human',
          isHuman: true,
          content: 'edit the file',
        } as any,
      ],
    });
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch({ toolCallId: 'tc-hist', toolName: 'fs_edit', args: {} }, ctx);

    const firstCall = (appendMessage.mock.calls[0] ?? []) as any[];
    const persisted = (firstCall[1]?.content ?? '') as string;
    expect(persisted).not.toContain('_fileChanges');
  });

  it('persists complete file changes for formatted write tools without returning them to the LLM', async () => {
    const fileChanges = [
      { filePath: '/ws/write.ts', oldContent: 'old', newContent: 'new' },
    ];
    const toolManager = {
      get: vi.fn(() => ({
        metadata: {},
        formatForLlm: () => 'Wrote write.ts',
      })),
      execute: vi.fn(async () => ({
        ok: true,
        result: {
          status: 'ok',
          data: { path: 'write.ts', written: true },
          _fileChanges: fileChanges,
        },
      })),
    } as any;
    const sessionManager = {
      appendToolCallRequest: vi.fn(async () => undefined),
      appendToolCallResult: vi.fn(async () => undefined),
    } as any;
    createEmitService(vi.fn());
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    const response = await dispatcher.dispatch(
      { toolCallId: 'tc-durable-diff', toolName: 'fs_write', args: {} },
      makeContext()
    );

    expect(response.result).toBe('Wrote write.ts');
    expect(sessionManager.appendToolCallResult).toHaveBeenCalledWith(
      'sess-1',
      'tc-durable-diff',
      expect.objectContaining({ _fileChanges: fileChanges }),
      'Wrote write.ts',
      'result',
      expect.any(String)
    );
  });

  it('does NOT emit code_edit_proposal on execution failure', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({ ok: false, error: 'write failed' })),
    } as any;

    const sessionManager = { appendMessage: vi.fn(async () => undefined) } as any;
    const ctx = makeContext();
    const emit = vi.fn();
    createEmitService(emit);
    const dispatcher = createDispatcher(toolManager, sessionManager, {} as any);

    await dispatcher.dispatch({ toolCallId: 'tc-fail', toolName: 'fs_edit', args: {} }, ctx);
    const events = emit.mock.calls.map((c: any[]) => c[0]);
    const proposal = events.find((e: any) => e.kind === 'code_edit_proposal');

    expect(proposal).toBeUndefined();
  });
});
