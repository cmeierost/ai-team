import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '@ai-team/core';
import { normalizeMessagesForProvider } from './index.js';

describe('normalizeMessagesForProvider', () => {
  const openAiCompatibleConfig: LlmConfig = {
    provider: 'openai-compatible',
    baseUrl: 'https://api.llmhub.infs.ai/v1',
    model: 'best-chat',
  };

  it('merges leading system messages for openai-compatible requests', () => {
    const request = {
      model: 'best-chat',
      messages: [
        { role: 'system' as const, content: 'system-1' },
        { role: 'system' as const, content: 'system-2' },
        { role: 'system' as const, content: 'system-3' },
        { role: 'assistant' as const, content: 'previous reply' },
        { role: 'user' as const, content: 'hello' },
      ],
    };

    const normalized = normalizeMessagesForProvider(request, openAiCompatibleConfig);
    const messages = normalized.messages as Array<{ role: string; content: string }>;

    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      role: 'system',
      content: 'system-1\n\nsystem-2\n\nsystem-3',
    });
    expect(messages[1]).toEqual({ role: 'assistant', content: 'previous reply' });
    expect(messages[2]).toEqual({ role: 'user', content: 'hello' });
  });

  it('keeps requests unchanged for non-openai-compatible providers', () => {
    const request = {
      model: 'claude-haiku-4.5',
      messages: [
        { role: 'system' as const, content: 'system-1' },
        { role: 'system' as const, content: 'system-2' },
        { role: 'user' as const, content: 'hello' },
      ],
    };

    const normalized = normalizeMessagesForProvider(request, {
      provider: 'github-copilot',
      model: 'claude-haiku-4.5',
    });

    expect(normalized).toEqual(request);
  });
});
