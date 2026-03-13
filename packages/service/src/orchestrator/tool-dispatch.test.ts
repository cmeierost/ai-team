import { describe, expect, it, vi } from 'vitest';
import { dispatchToolCall } from './tool-dispatch.js';
import type { OrchestratorContext } from './pipeline-context.js';

function makeContext(overrides?: Partial<OrchestratorContext>): OrchestratorContext {
  const base: OrchestratorContext = {
    agent: { id: 'agent-a', name: 'Agent A', role: 'dev', systemPrompt: '' } as any,
    workspaceRoot: 'c:/workspace',
    sessionId: 'sess-1',
    history: [],
    hooks: {
      emit: vi.fn(),
      questionConfirm: vi.fn(async () => true),
    },
    toolManager: {
      execute: vi.fn(async () => ({ ok: true, result: { ok: true } })),
    } as any,
    sessionManager: {
      appendMessage: vi.fn(async () => undefined),
    } as any,
    agentManager: {} as any,
    skillManager: {} as any,
    llmService: {} as any,
    contextManager: {} as any,
  };

  return { ...base, ...overrides };
}

describe('dispatchToolCall denial metadata', () => {
  it('emits tool result event with a preview of successful output', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({
        ok: true,
        result: {
          tools: ['tool_list', 'fs_read'],
          count: 2,
        },
      })),
    } as any;

    const ctx = makeContext({ toolManager });

    await dispatchToolCall(
      {
        toolCallId: 'tc-preview',
        toolName: 'tool_list',
        args: {},
      },
      ctx,
    );

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
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
      }),
    );
  });

  it('truncates long successful tool result previews', async () => {
    const longText = 'x'.repeat(400);
    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: longText })),
    } as any;

    const ctx = makeContext({ toolManager });

    await dispatchToolCall(
      {
        toolCallId: 'tc-preview-long',
        toolName: 'tool_list',
        args: {},
      },
      ctx,
    );

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
    const resultEvent = emit.mock.calls
      .map(call => call[0])
      .find(event => event?.kind === 'tool' && event?.toolPhase === 'result' && event?.toolName === 'tool_list');

    expect(typeof resultEvent?.message).toBe('string');
    expect(resultEvent?.message.length).toBeLessThanOrEqual(220);
    expect(resultEvent?.message.endsWith('…')).toBe(true);
  });

  it('does not truncate JSON tool result previews', async () => {
    const payload = {
      type: 'tool_list_result',
      entries: Array.from({ length: 40 }, (_, idx) => ({ name: `tool_${idx + 1}`, description: 'x'.repeat(24) })),
    };

    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: payload })),
    } as any;

    const ctx = makeContext({ toolManager });

    await dispatchToolCall(
      {
        toolCallId: 'tc-preview-json',
        toolName: 'tool_list',
        args: {},
      },
      ctx,
    );

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
    const resultEvent = emit.mock.calls
      .map(call => call[0])
      .find(event => event?.kind === 'tool' && event?.toolPhase === 'result' && event?.toolName === 'tool_list');

    expect(resultEvent?.message).toBe(JSON.stringify(payload, null, 2));
    expect((resultEvent?.message as string).length).toBeGreaterThan(220);
  });

  it('returns user-denied metadata when confirmation is rejected', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: { never: 'called' } })),
    } as any;

    const ctx = makeContext({
      toolManager,
      hooks: {
        emit: vi.fn(),
        questionConfirm: vi.fn(async () => false),
      },
    });

    const result = await dispatchToolCall(
      {
        toolCallId: 'tc-1',
        toolName: 'fs_write_file',
        args: { filePath: 'a.ts', content: 'x' },
      },
      ctx,
    );

    expect(toolManager.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.denial).toBeDefined();
    expect(result.denial?.kind).toBe('user-denied');
    expect(result.denial?.reasonCode).toBe('user_declined');

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'fs_write_file',
        toolPhase: 'denied',
        toolDenial: expect.objectContaining({
          kind: 'user-denied',
          reasonCode: 'user_declined',
        }),
      }),
    );
  });

  it('returns policy-denied metadata from permission_denied tool result', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({
        ok: true,
        result: {
          status: 'permission_denied',
          message: 'Agent cannot write requested file.',
          blockedFiles: [{ filePath: 'src/secret.ts', reason: 'scope mismatch' }],
          access: {
            allowed: false,
            alternativeContexts: [
              { contextId: 'agent-infra', allowedPaths: ['src/secret.ts'] },
            ],
          },
        },
      })),
    } as any;

    const ctx = makeContext({ toolManager });

    const result = await dispatchToolCall(
      {
        toolCallId: 'tc-2',
        toolName: 'fs_read',
        args: { filePath: 'src/secret.ts' },
      },
      ctx,
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

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
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
      }),
    );
  });

  it('returns execution-failed metadata when tool execution fails', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({ ok: false, error: 'Boom' })),
    } as any;

    const ctx = makeContext({ toolManager });

    const result = await dispatchToolCall(
      {
        toolCallId: 'tc-3',
        toolName: 'fs_read',
        args: { filePath: 'src/a.ts' },
      },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.denial).toBeDefined();
    expect(result.denial?.kind).toBe('execution-failed');
    expect(result.denial?.reasonCode).toBe('tool_execution_failed');
  });

  it('routes com_ask select questions to interactive hooks without tool manager execution', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: { never: 'called' } })),
    } as any;

    const ctx = makeContext({
      toolManager,
      hooks: {
        emit: vi.fn(),
        questionSelect: vi.fn(async () => 'agent-b'),
      },
    });

    const result = await dispatchToolCall(
      {
        toolCallId: 'tc-ask-select',
        toolName: 'com_ask',
        args: {
          question: 'Who should take this task?',
          questionType: 'select',
          choices: [
            { name: 'Agent A', value: 'agent-a' },
            { name: 'Agent B', value: 'agent-b' },
          ],
        },
      },
      ctx,
    );

    expect(toolManager.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.result).toEqual({
      question: 'Who should take this task?',
      questionType: 'select',
      answer: 'agent-b',
    });

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'com_ask',
        toolPhase: 'result',
        toolResult: expect.objectContaining({
          toolName: 'com_ask',
          outcome: 'result',
          result: expect.objectContaining({
            request: expect.objectContaining({
              question: 'Who should take this task?',
              questionType: 'select',
            }),
            response: expect.objectContaining({
              answer: 'agent-b',
            }),
          }),
        }),
      }),
    );
  });

  it('returns a validation error for invalid com_ask payloads', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: { never: 'called' } })),
    } as any;

    const ctx = makeContext({ toolManager });

    const result = await dispatchToolCall(
      {
        toolCallId: 'tc-ask-invalid',
        toolName: 'com_ask',
        args: {
          question: 'Pick one',
          questionType: 'select',
          choices: [],
        },
      },
      ctx,
    );

    expect(toolManager.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.result).toBe("questionType 'select' requires a non-empty choices array.");

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'tool',
        toolName: 'com_ask',
        toolPhase: 'error',
        toolResult: expect.objectContaining({
          toolName: 'com_ask',
          outcome: 'error',
          result: expect.objectContaining({
            error: "questionType 'select' requires a non-empty choices array.",
          }),
        }),
      }),
    );
  });

  it('supports allowOther for select by prompting follow-up input when other is chosen', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: { never: 'called' } })),
    } as any;

    const ctx = makeContext({
      toolManager,
      hooks: {
        emit: vi.fn(),
        questionSelect: vi.fn(async () => '__other__'),
        questionInput: vi.fn(async () => '77'),
      },
    });

    const result = await dispatchToolCall(
      {
        toolCallId: 'tc-ask-select-other',
        toolName: 'com_ask',
        args: {
          question: 'Pick a number',
          questionType: 'select',
          allowOther: true,
          choices: [
            { name: '10', value: '10' },
            { name: '20', value: '20' },
          ],
        },
      },
      ctx,
    );

    expect(toolManager.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.result).toEqual({
      question: 'Pick a number',
      questionType: 'select',
      answer: '77',
    });
  });

  it('supports multiselect alias and appends custom value when other is selected', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: { never: 'called' } })),
    } as any;

    const ctx = makeContext({
      toolManager,
      hooks: {
        emit: vi.fn(),
        questionChecklist: vi.fn(async () => ['a', '__other__']),
        questionInput: vi.fn(async () => 'custom-value'),
      },
    });

    const result = await dispatchToolCall(
      {
        toolCallId: 'tc-ask-multiselect-other',
        toolName: 'com_ask',
        args: {
          question: 'Pick one or more',
          questionType: 'multiselect',
          allowOther: true,
          choices: [
            { name: 'A', value: 'a' },
            { name: 'B', value: 'b' },
          ],
        },
      },
      ctx,
    );

    expect(toolManager.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.result).toEqual({
      question: 'Pick one or more',
      questionType: 'multiselect',
      answer: ['a', 'custom-value'],
    });
  });

  it('supports rating mode and returns numeric answer', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: { never: 'called' } })),
    } as any;

    const ctx = makeContext({
      toolManager,
      hooks: {
        emit: vi.fn(),
        questionSelect: vi.fn(async () => '4'),
      },
    });

    const result = await dispatchToolCall(
      {
        toolCallId: 'tc-ask-rating',
        toolName: 'com_ask',
        args: {
          question: 'Rate confidence',
          questionType: 'rating',
          min: 1,
          max: 5,
          step: 1,
          default: 3,
        },
      },
      ctx,
    );

    expect(toolManager.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.result).toEqual({
      question: 'Rate confidence',
      questionType: 'rating',
      answer: 4,
    });
  });

  it('supports agent_select mode from current team roster', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: { never: 'called' } })),
    } as any;

    const ctx = makeContext({
      toolManager,
      hooks: {
        emit: vi.fn(),
        questionSelect: vi.fn(async () => 'agent-b'),
      },
      agentManager: {
        getAllAgents: () => [
          { id: 'agent-a', name: 'Agent A', role: 'dev' },
          { id: 'agent-b', name: 'Agent B', role: 'qa' },
        ],
      } as any,
    });

    const result = await dispatchToolCall(
      {
        toolCallId: 'tc-ask-agent-select',
        toolName: 'com_ask',
        args: {
          question: 'Who should take this?',
          questionType: 'agent_select',
          default: 'agent-a',
          recommended: ['agent-b'],
        },
      },
      ctx,
    );

    expect(toolManager.execute).not.toHaveBeenCalled();
    expect(result.isError).toBe(false);
    expect(result.result).toEqual({
      question: 'Who should take this?',
      questionType: 'agent_select',
      answer: 'agent-b',
    });
  });

  it('auto-trims very large tool output before persisting history', async () => {
    const large = Array.from({ length: 260 }, (_, idx) => `line-${idx + 1}`).join('\n');
    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: large })),
    } as any;

    const appendMessage = vi.fn(async () => undefined);
    const ctx = makeContext({
      toolManager,
      sessionManager: { appendMessage } as any,
      history: [
        {
          timestamp: new Date().toISOString(),
          from: 'human',
          isHuman: true,
          content: 'run tool please',
        } as any,
      ],
    });

    await dispatchToolCall(
      {
        toolCallId: 'tc-auto-trim',
        toolName: 'tool_list',
        args: {},
      },
      ctx,
    );

    const firstCall = (appendMessage.mock.calls[0] ?? []) as any[];
    const persisted = (firstCall[1]?.content ?? '') as string;
    expect(persisted).toContain('[filtered:auto-max-lines]');
    expect(persisted).toContain('line-1');
    expect(persisted).not.toContain('line-260');
  });

  it('does not auto-trim large JSON output before persisting history', async () => {
    const largeJson = {
      items: Array.from({ length: 260 }, (_, idx) => ({
        id: idx + 1,
        value: `entry-${idx + 1}`,
      })),
    };

    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: largeJson })),
    } as any;

    const appendMessage = vi.fn(async () => undefined);
    const ctx = makeContext({
      toolManager,
      sessionManager: { appendMessage } as any,
      history: [
        {
          timestamp: new Date().toISOString(),
          from: 'human',
          isHuman: true,
          content: 'run tool please',
        } as any,
      ],
    });

    await dispatchToolCall(
      {
        toolCallId: 'tc-auto-json',
        toolName: 'tool_list',
        args: {},
      },
      ctx,
    );

    const firstCall = (appendMessage.mock.calls[0] ?? []) as any[];
    const persisted = (firstCall[1]?.content ?? '') as string;
    expect(persisted).not.toContain('[filtered:auto-max-lines]');
    expect(persisted).not.toContain('[filtered:auto-max-chars]');
    expect(persisted).toContain('"id": 260');
  });

  it('uses llm summary transform when summary intent is present', async () => {
    const toolManager = {
      execute: vi.fn(async () => ({ ok: true, result: 'alpha\nbeta\ngamma' })),
    } as any;

    const appendMessage = vi.fn(async () => undefined);
    const rawChat = vi.fn(async () => '- key point A\n- key point B');

    const ctx = makeContext({
      toolManager,
      sessionManager: { appendMessage } as any,
      llmService: { rawChat } as any,
      history: [
        {
          timestamp: new Date().toISOString(),
          from: 'human',
          isHuman: true,
          content: 'summarize the most important parts',
        } as any,
      ],
    });

    await dispatchToolCall(
      {
        toolCallId: 'tc-summary',
        toolName: 'tool_list',
        args: {},
      },
      ctx,
    );

    expect(rawChat).toHaveBeenCalledTimes(1);
    const firstCall = (appendMessage.mock.calls[0] ?? []) as any[];
    const persisted = (firstCall[1]?.content ?? '') as string;
    expect(persisted).toContain('[filtered:summary');
    expect(persisted).toContain('key point A');
  });
});
