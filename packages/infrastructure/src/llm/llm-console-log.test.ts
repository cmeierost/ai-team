import { describe, expect, it, vi } from 'vitest';
import { InfrastructureLlmConsoleLog, type LlmLogPayload } from './llm-console-log.js';

function createBasePayload(): LlmLogPayload {
  return {
    id: 'test-id',
    timestamp: new Date('2026-04-15T00:00:00.000Z').toISOString(),
    provider: 'openai-compatible',
    model: 'best-chat',
    mode: 'raw-chat',
    request: {
      messages: [{ role: 'user', content: 'Title:' } as any],
    },
  };
}

describe('InfrastructureLlmConsoleLog.write', () => {
  it('prints warning (not error) when fallback mode has an error', () => {
    const logger = new InfrastructureLlmConsoleLog();
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      logger.write({
        ...createBasePayload(),
        response: {
          text: 'Fix Session Title Persistence',
          raw: { mode: 'fallback' },
        },
        error: {
          message: 'LLM returned an empty title response',
        },
      });
    } finally {
      spy.mockRestore();
    }

    const output = writes.join('');
    expect(output).toContain('warning');
    expect(output).toContain('LLM returned an empty title response');
    expect(output).not.toContain(' error ');
  });

  it('prints error for non-fallback errors', () => {
    const logger = new InfrastructureLlmConsoleLog();
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      writes.push(String(chunk));
      return true;
    });

    try {
      logger.write({
        ...createBasePayload(),
        error: {
          message: 'network failure',
        },
      });
    } finally {
      spy.mockRestore();
    }

    const output = writes.join('');
    expect(output).toContain('error');
    expect(output).toContain('network failure');
  });
});
