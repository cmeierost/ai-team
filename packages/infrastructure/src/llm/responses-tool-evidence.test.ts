import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '@ai-team/core';
import {
  buildRuntimeToolEvidence,
  getChatRequestTimeoutMs,
  LlmService,
  resolveResponsesContentTypeForRole,
  shouldUseResponsesApiForToolLoop,
} from './index.js';

describe('getChatRequestTimeoutMs', () => {
  it('uses longer timeout for GPT-5 on api.openai.com', () => {
    const config: LlmConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
    };

    expect(getChatRequestTimeoutMs(config, 'gpt-5.4')).toBe(90_000);
  });

  it('uses default timeout for non-GPT-5 or non-OpenAI hosts', () => {
    const proxyConfig: LlmConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://proxy.example.com/v1',
      model: 'gpt-5.4',
    };

    const nonGpt5Config: LlmConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
    };

    expect(getChatRequestTimeoutMs(proxyConfig, 'gpt-5.4')).toBe(30_000);
    expect(getChatRequestTimeoutMs(nonGpt5Config, 'gpt-4o')).toBe(30_000);
  });
});

describe('resolveResponsesContentTypeForRole', () => {
  it('uses input_text for system and user turns', () => {
    expect(resolveResponsesContentTypeForRole('system')).toBe('input_text');
    expect(resolveResponsesContentTypeForRole('user')).toBe('input_text');
  });

  it('uses output_text for assistant turns', () => {
    expect(resolveResponsesContentTypeForRole('assistant')).toBe('output_text');
  });
});

describe('shouldUseResponsesApiForToolLoop', () => {
  it('enables Responses tool loop for OpenAI GPT-5 models', () => {
    const config: LlmConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
    };

    expect(shouldUseResponsesApiForToolLoop(config, 'gpt-5')).toBe(true);
    expect(shouldUseResponsesApiForToolLoop(config, 'gpt-5-mini')).toBe(true);
  });

  it('disables Responses tool loop for non-OpenAI hosts or non-GPT-5 models', () => {
    const openAiCompatible: LlmConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://example-proxy.local/v1',
      model: 'gpt-5',
    };

    const copilot: LlmConfig = {
      provider: 'github-copilot',
      model: 'gpt-5',
    };

    expect(shouldUseResponsesApiForToolLoop(openAiCompatible, 'gpt-5')).toBe(false);
    expect(shouldUseResponsesApiForToolLoop(copilot, 'gpt-5')).toBe(false);
    expect(
      shouldUseResponsesApiForToolLoop(
        { ...openAiCompatible, baseUrl: 'https://api.openai.com/v1' },
        'gpt-4o'
      )
    ).toBe(false);
  });
});

describe('buildRuntimeToolEvidence', () => {
  it('serializes successful tool output with direct provenance', () => {
    const evidence = buildRuntimeToolEvidence(
      {
        toolName: 'http_fetch',
        result: { title: 'Conductor OSS' },
        isError: false,
      },
      { url: 'https://conductor-oss.org' }
    );

    expect(evidence).toEqual({
      toolName: 'http_fetch',
      args: { url: 'https://conductor-oss.org' },
      status: 'success',
      content: JSON.stringify({ title: 'Conductor OSS' }),
      sourceType: 'tool',
      confidence: 'direct',
    });
  });

  it('serializes failed tool output with error status', () => {
    const evidence = buildRuntimeToolEvidence(
      {
        toolName: 'http_fetch',
        result: 'fetch failed',
        isError: true,
      },
      { url: 'https://conductor-oss.org' }
    );

    expect(evidence).toEqual({
      toolName: 'http_fetch',
      args: { url: 'https://conductor-oss.org' },
      status: 'failed',
      error: 'fetch failed',
      sourceType: 'tool',
      confidence: 'direct',
    });
  });
});

describe('LlmService.historyToMessages', () => {
  it('excludes archived and hidden messages from LLM context conversion', () => {
    const messages = [
      {
        timestamp: '2026-04-15T00:00:00.000Z',
        from: 'human',
        to: 'agent',
        isHuman: true,
        content: 'keep this',
      },
      {
        timestamp: '2026-04-15T00:00:00.500Z',
        from: 'agent',
        to: 'human',
        isHuman: false,
        content: 'manually hidden context',
        hiddenFromLlm: true,
      },
      {
        timestamp: '2026-04-15T00:00:01.000Z',
        from: 'agent',
        to: 'human',
        isHuman: false,
        content: 'transient failure message',
        archived: true,
      },
    ];

    const converted = LlmService.historyToMessages(messages as any, 'agent');

    expect(converted).toEqual([{ role: 'user', content: 'keep this' }]);
  });
});
