import { describe, expect, it, vi } from 'vitest';
import { ChatService } from './chat-service.js';

describe('ChatService tool result actions', () => {
  it('hides tool result from LLM by writing empty resultLlm', async () => {
    const sessionManager = {
      getLatestSession: vi.fn(async () => ({ id: 'session-1' })),
      listSessionMessages: vi.fn(async () => [
        {
          id: 10,
          from: 'agent-a',
          isHuman: false,
          content: '[tool:fs_read] done',
          timestamp: new Date().toISOString(),
          tool_calls: [
            {
              id: 101,
              tool: 'fs_read',
              result: { filePath: 'src/a.ts', content: 'const a = 1;' },
            },
          ],
        },
      ]),
      updateToolCallLlmResult: vi.fn(async () => undefined),
    } as any;

    const llmService = {
      ensureInitialized: vi.fn(async () => undefined),
    } as any;

    const service = new ChatService(
      { stream: vi.fn() } as any,
      sessionManager,
      {} as any,
      {} as any,
      llmService
    );

    const result = await service.setToolResultHidden('agent-a', '0', { hidden: true });

    expect(result).toEqual({ ok: true, hidden: true, toolCallId: 101 });
    expect(sessionManager.updateToolCallLlmResult).toHaveBeenCalledWith(101, '');
  });

  it('summarizes tool result with LLM and stores summary in resultLlm', async () => {
    const sessionManager = {
      getLatestSession: vi.fn(async () => ({ id: 'session-2' })),
      listSessionMessages: vi.fn(async () => [
        {
          id: 12,
          from: 'agent-b',
          isHuman: false,
          content: '[tool:grep] done',
          timestamp: new Date().toISOString(),
          tool_calls: [
            {
              id: 205,
              tool: 'grep_search',
              result: {
                matches: [
                  { file: 'a.ts', line: 1 },
                  { file: 'b.ts', line: 4 },
                ],
              },
            },
          ],
        },
      ]),
      summarizeForContextAsync: vi.fn(async () => ' concise tool summary '),
      updateToolCallLlmResult: vi.fn(async () => undefined),
    } as any;

    const llmService = {
      ensureInitialized: vi.fn(async () => undefined),
    } as any;

    const service = new ChatService(
      { stream: vi.fn() } as any,
      sessionManager,
      {} as any,
      {} as any,
      llmService
    );

    const result = await service.summarizeToolResult('agent-b', '0', {
      maxWords: 120,
      focusInstruction: 'only include key findings',
    });

    expect(llmService.ensureInitialized).toHaveBeenCalledOnce();
    expect(sessionManager.summarizeForContextAsync).toHaveBeenCalledWith(
      llmService,
      expect.any(String),
      120,
      'only include key findings'
    );
    expect(sessionManager.updateToolCallLlmResult).toHaveBeenCalledWith(
      205,
      'concise tool summary'
    );
    expect(result).toEqual({ ok: true, toolCallId: 205, summary: 'concise tool summary' });
  });

  it('falls back to deterministic summary when LLM summarize fails', async () => {
    const sessionManager = {
      getLatestSession: vi.fn(async () => ({ id: 'session-3' })),
      listSessionMessages: vi.fn(async () => [
        {
          id: 14,
          from: 'agent-c',
          isHuman: false,
          content: '[tool:search] done',
          timestamp: new Date().toISOString(),
          tool_calls: [
            {
              id: 307,
              tool: 'semantic_search',
              result: {
                summary:
                  'Found references in service and web layers. Main touchpoints are chat-service and ToolCallBlock. Recommend updating router contract and controller wiring.',
              },
            },
          ],
        },
      ]),
      summarizeForContextAsync: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
      updateToolCallLlmResult: vi.fn(async () => undefined),
    } as any;

    const llmService = {
      ensureInitialized: vi.fn(async () => {
        throw new Error('no model configured');
      }),
    } as any;

    const service = new ChatService(
      { stream: vi.fn() } as any,
      sessionManager,
      {} as any,
      {} as any,
      llmService
    );

    const result = await service.summarizeToolResult('agent-c', '0', {
      maxWords: 30,
      focusInstruction: 'focus on actionable fix points',
    });

    expect(result.ok).toBe(true);
    expect(result.toolCallId).toBe(307);
    expect(result.summary.length).toBeGreaterThan(0);
    expect(result.summary.length).toBeLessThan(
      JSON.stringify(
        {
          summary:
            'Found references in service and web layers. Main touchpoints are chat-service and ToolCallBlock. Recommend updating router contract and controller wiring.',
        },
        null,
        2
      ).length
    );
    expect(sessionManager.updateToolCallLlmResult).toHaveBeenCalledWith(307, expect.any(String));
  });

  it('replaces non-compressive LLM summary with compact fallback', async () => {
    const sourceResult = {
      output:
        'This tool output includes a detailed set of findings, several stack traces, repeated diagnostics, and multiple examples that should be compressed for context.',
    };

    const sessionManager = {
      getLatestSession: vi.fn(async () => ({ id: 'session-4' })),
      listSessionMessages: vi.fn(async () => [
        {
          id: 16,
          from: 'agent-d',
          isHuman: false,
          content: '[tool:analyze] done',
          timestamp: new Date().toISOString(),
          tool_calls: [
            {
              id: 411,
              tool: 'analyze_file',
              result: sourceResult,
            },
          ],
        },
      ]),
      summarizeForContextAsync: vi.fn(async () => {
        const sourceText = JSON.stringify(sourceResult, null, 2);
        return `${sourceText}\n${sourceText}`;
      }),
      updateToolCallLlmResult: vi.fn(async () => undefined),
    } as any;

    const llmService = {
      ensureInitialized: vi.fn(async () => undefined),
    } as any;

    const service = new ChatService(
      { stream: vi.fn() } as any,
      sessionManager,
      {} as any,
      {} as any,
      llmService
    );

    const result = await service.summarizeToolResult('agent-d', '0', {
      maxWords: 25,
    });

    const sourceText = JSON.stringify(sourceResult, null, 2);
    const sourceWordCount = sourceText.replaceAll(/\s+/g, ' ').trim().split(' ').length;
    const summaryWordCount = result.summary.replaceAll(/\s+/g, ' ').trim().split(' ').length;
    const sourceByteCount = new TextEncoder().encode(sourceText).length;
    const summaryByteCount = new TextEncoder().encode(result.summary).length;

    expect(result.ok).toBe(true);
    expect(result.toolCallId).toBe(411);
    expect(summaryWordCount < sourceWordCount || summaryByteCount < sourceByteCount).toBe(true);
    expect(sessionManager.updateToolCallLlmResult).toHaveBeenCalledWith(411, result.summary);
  });

  it('enforces byte-level compression for low-word dense tool outputs', async () => {
    const denseToken = 'x'.repeat(1700);
    const sourceResult = { output: denseToken };

    const sessionManager = {
      getLatestSession: vi.fn(async () => ({ id: 'session-5' })),
      listSessionMessages: vi.fn(async () => [
        {
          id: 19,
          from: 'agent-e',
          isHuman: false,
          content: '[tool:dense] done',
          timestamp: new Date().toISOString(),
          tool_calls: [
            {
              id: 509,
              tool: 'raw_dump',
              result: sourceResult,
            },
          ],
        },
      ]),
      summarizeForContextAsync: vi.fn(async () => JSON.stringify(sourceResult, null, 2)),
      updateToolCallLlmResult: vi.fn(async () => undefined),
    } as any;

    const llmService = {
      ensureInitialized: vi.fn(async () => undefined),
    } as any;

    const service = new ChatService(
      { stream: vi.fn() } as any,
      sessionManager,
      {} as any,
      {} as any,
      llmService
    );

    const result = await service.summarizeToolResult('agent-e', '0', {
      maxWords: 120,
    });

    const sourceBytes = new TextEncoder().encode(JSON.stringify(sourceResult, null, 2)).length;
    const summaryBytes = new TextEncoder().encode(result.summary).length;

    expect(result.ok).toBe(true);
    expect(result.toolCallId).toBe(509);
    expect(summaryBytes).toBeLessThan(sourceBytes);
    expect(sessionManager.updateToolCallLlmResult).toHaveBeenCalledWith(509, result.summary);
  });

  it('resummarizes from raw tool result when compacted result already exists', async () => {
    const sessionManager = {
      getLatestSession: vi.fn(async () => ({ id: 'session-6' })),
      listSessionMessages: vi.fn(async () => [
        {
          id: 21,
          from: 'agent-f',
          isHuman: false,
          content: '[tool:review] done',
          timestamp: new Date().toISOString(),
          tool_calls: [
            {
              id: 611,
              tool: 'review',
              result: {
                important: 'RAW_SOURCE_MARKER',
                details: 'Long raw output that should be the source for new summarization.',
              },
              resultLlm: 'old compacted summary should not be used as source',
            },
          ],
        },
      ]),
      summarizeForContextAsync: vi.fn(async () => 'new summary from raw'),
      updateToolCallLlmResult: vi.fn(async () => undefined),
    } as any;

    const llmService = {
      ensureInitialized: vi.fn(async () => undefined),
    } as any;

    const service = new ChatService(
      { stream: vi.fn() } as any,
      sessionManager,
      {} as any,
      {} as any,
      llmService
    );

    const result = await service.summarizeToolResult('agent-f', '0', {
      maxWords: 80,
      focusInstruction: 'what changed the most',
    });

    expect(sessionManager.summarizeForContextAsync).toHaveBeenCalledWith(
      llmService,
      expect.stringContaining('RAW_SOURCE_MARKER'),
      80,
      'what changed the most'
    );
    expect(result).toEqual({ ok: true, toolCallId: 611, summary: 'new summary from raw' });
  });

  it('fallback summarizes key points instead of plain prefix cut for multi-sentence text', async () => {
    const rawText =
      'Build succeeded for service package. Build failed for web package due to type mismatch. The main change was adding compactness controls and summarize retry logic. Follow-up action: align type signatures in view props.';

    const sessionManager = {
      getLatestSession: vi.fn(async () => ({ id: 'session-7' })),
      listSessionMessages: vi.fn(async () => [
        {
          id: 23,
          from: 'agent-g',
          isHuman: false,
          content: '[tool:status] done',
          timestamp: new Date().toISOString(),
          tool_calls: [
            {
              id: 701,
              tool: 'status_report',
              result: rawText,
            },
          ],
        },
      ]),
      summarizeForContextAsync: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
      updateToolCallLlmResult: vi.fn(async () => undefined),
    } as any;

    const llmService = {
      ensureInitialized: vi.fn(async () => {
        throw new Error('no model configured');
      }),
    } as any;

    const service = new ChatService(
      { stream: vi.fn() } as any,
      sessionManager,
      {} as any,
      {} as any,
      llmService
    );

    const result = await service.summarizeToolResult('agent-g', '0', {
      maxWords: 28,
      focusInstruction: 'what changed most and follow-up action',
    });

    expect(result.ok).toBe(true);
    expect(result.toolCallId).toBe(701);
    expect(result.summary).toContain('- ');
    expect(result.summary.toLowerCase()).toContain('change');
    expect(result.summary.length).toBeLessThan(rawText.length);
  });

  it('fallback summarizes command execution payload into git state bullets', async () => {
    const payload = {
      status: 'executed',
      command: '/run git status',
      output:
        '\n$ git status\n\nOn branch file-context\nChanges not staged for commit:\n  (use "git add <file>..." to update what will be committed)\n\tmodified:   packages/service/src/routers/chat-service.ts\n\tmodified:   packages/web/src/components/chat-panel/ChatMessagesView.tsx\n\tmodified:   packages/web/src/components/chat-panel/ChatPanelView.tsx\n\nUntracked files:\n  (use "git add <file>..." to include in what will be committed)\n\tpackages/web/src/hooks/usePlanning.ts\n\tpackages/web/src/pages/PlanningPage.tsx\n\nno changes added to commit (use "git add" and/or "git commit -a")\n',
    };

    const sessionManager = {
      getLatestSession: vi.fn(async () => ({ id: 'session-8' })),
      listSessionMessages: vi.fn(async () => [
        {
          id: 25,
          from: 'agent-h',
          isHuman: false,
          content: '[tool:terminal] done',
          timestamp: new Date().toISOString(),
          tool_calls: [
            {
              id: 809,
              tool: 'run_in_terminal',
              result: payload,
            },
          ],
        },
      ]),
      summarizeForContextAsync: vi.fn(async () => {
        throw new Error('provider unavailable');
      }),
      updateToolCallLlmResult: vi.fn(async () => undefined),
    } as any;

    const llmService = {
      ensureInitialized: vi.fn(async () => {
        throw new Error('no model configured');
      }),
    } as any;

    const service = new ChatService(
      { stream: vi.fn() } as any,
      sessionManager,
      {} as any,
      {} as any,
      llmService
    );

    const result = await service.summarizeToolResult('agent-h', '0', {
      maxWords: 60,
      focusInstruction: 'what changed most',
    });

    expect(result.ok).toBe(true);
    expect(result.toolCallId).toBe(809);
    expect(result.summary).toContain('Command: /run git status');
    expect(result.summary).toContain('Branch: file-context');
    expect(result.summary).toContain('unstaged local changes');
    expect(result.summary).toContain('Change volume:');
    expect(result.summary).toContain('Most changed areas:');
    expect(result.summary).toContain('Focus answer: the largest change concentration');
    expect(result.summary.length).toBeLessThan(JSON.stringify(payload, null, 2).length);
  });
});
