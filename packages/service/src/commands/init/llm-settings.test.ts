import { describe, expect, it, vi } from 'vitest';
import {
  askLlmSetup,
  providerNameToProviderRef,
} from './llm-settings.js';

describe('llm-settings', () => {
  it('derives provider ref from provider name', () => {
    expect(providerNameToProviderRef('LLM Hub Infs AI')).toBe('llm-hub-infs-ai');
  });

  it('asks openai-compatible setup in providerName -> baseUrl -> apiKey order', async () => {
    const select = vi
      .fn()
      .mockResolvedValueOnce('openai-compatible')
      .mockResolvedValueOnce('__custom__');

    const input = vi
      .fn()
      .mockResolvedValueOnce('LLM Hub')
      .mockResolvedValueOnce('https://api.llmhub.infs.ai/v1')
      .mockResolvedValueOnce('best-chat');

    const password = vi.fn().mockResolvedValue('sk-test');
    const writeLine = vi.fn();
    const writeWarn = vi.fn();

    const result = await askLlmSetup({
      select,
      input,
      password,
      writeLine,
      writeWarn,
    });

    expect(input).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        message: expect.stringMatching(/^Provider name/),
      })
    );
    expect(input).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: 'Base URL:',
      })
    );
    expect(password).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'API key:',
      })
    );

    expect(result).toEqual({
      provider: 'openai-compatible',
      providerRef: 'llm-hub',
      apiKey: 'sk-test',
      baseUrl: 'https://api.llmhub.infs.ai/v1',
      model: 'best-chat',
    });
  });
});
