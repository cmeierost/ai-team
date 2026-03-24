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
      get: vi.fn(() => undefined),
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
      get: vi.fn(() => undefined),
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
      get: vi.fn(() => undefined),
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
      get: vi.fn(() => undefined),
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
      get: vi.fn(() => undefined),
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
      get: vi.fn(() => undefined),
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
      get: vi.fn(() => undefined),
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

  it('auto-trims very large tool output before persisting history', async () => {
    const large = Array.from({ length: 260 }, (_, idx) => `line-${idx + 1}`).join('\n');
    const toolManager = {
      get: vi.fn(() => undefined),
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
      get: vi.fn(() => undefined),
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
      get: vi.fn(() => undefined),
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

describe('code_edit_proposal emission', () => {
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

    const ctx = makeContext({ toolManager });

    await dispatchToolCall(
      { toolCallId: 'tc-diff-1', toolName: 'fs_edit', args: {} },
      ctx,
    );

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
    const events = emit.mock.calls.map((c: any[]) => c[0]);
    const proposal = events.find((e: any) => e.kind === 'code_edit_proposal');

    expect(proposal).toBeDefined();
    expect(proposal.proposalId).toBe('fs_edit-tc-diff-1');
    expect(proposal.agentName).toBe('Agent A');
    expect(proposal.filesChanged).toBe(1);
    expect(proposal.files).toEqual([
      { filePath: '/ws/app.ts', oldContent: 'const x = 1;', newContent: 'const x = 42;' },
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

    const ctx = makeContext({ toolManager });

    await dispatchToolCall(
      { toolCallId: 'tc-diff-multi', toolName: 'multiedit', args: {} },
      ctx,
    );

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
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

    const ctx = makeContext({ toolManager });

    await dispatchToolCall(
      { toolCallId: 'tc-no-diff', toolName: 'fs_edit', args: {} },
      ctx,
    );

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
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

    const ctx = makeContext({ toolManager });

    await dispatchToolCall(
      { toolCallId: 'tc-empty-diff', toolName: 'fs_edit', args: {} },
      ctx,
    );

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
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
          _fileChanges: [
            { filePath: '/ws/c.ts', oldContent: 'old', newContent: 'new' },
          ],
        },
      })),
    } as any;

    const ctx = makeContext({ toolManager });

    const response = await dispatchToolCall(
      { toolCallId: 'tc-strip', toolName: 'fs_edit', args: {} },
      ctx,
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
          _fileChanges: [
            { filePath: '/ws/d.ts', oldContent: 'old', newContent: 'new' },
          ],
        },
      })),
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
          content: 'edit the file',
        } as any,
      ],
    });

    await dispatchToolCall(
      { toolCallId: 'tc-hist', toolName: 'fs_edit', args: {} },
      ctx,
    );

    const firstCall = (appendMessage.mock.calls[0] ?? []) as any[];
    const persisted = (firstCall[1]?.content ?? '') as string;
    expect(persisted).not.toContain('_fileChanges');
  });

  it('does NOT emit code_edit_proposal on execution failure', async () => {
    const toolManager = {
      get: vi.fn(() => undefined),
      execute: vi.fn(async () => ({ ok: false, error: 'write failed' })),
    } as any;

    const ctx = makeContext({ toolManager });

    await dispatchToolCall(
      { toolCallId: 'tc-fail', toolName: 'fs_edit', args: {} },
      ctx,
    );

    const emit = ctx.hooks.emit as ReturnType<typeof vi.fn>;
    const events = emit.mock.calls.map((c: any[]) => c[0]);
    const proposal = events.find((e: any) => e.kind === 'code_edit_proposal');

    expect(proposal).toBeUndefined();
  });
});
