import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '@ai-team/core';
import { LlmToolEvidenceBuilder } from './llm-tool-evidence.js';
import { LlmTimeoutPolicy } from './llm-timeout-policy.js';

const toolEvidenceBuilder = new LlmToolEvidenceBuilder();
const timeoutPolicy = new LlmTimeoutPolicy();

describe('getChatRequestTimeoutMs', () => {
  it('uses longer timeout for GPT-5 on api.openai.com', () => {
    const config: LlmConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
    };

    expect(timeoutPolicy.getChatRequestTimeoutMs(config, 'gpt-5.4')).toBe(90_000);
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

    expect(timeoutPolicy.getChatRequestTimeoutMs(proxyConfig, 'gpt-5.4')).toBe(30_000);
    expect(timeoutPolicy.getChatRequestTimeoutMs(nonGpt5Config, 'gpt-4o')).toBe(30_000);
  });
});

describe('resolveResponsesContentTypeForRole', () => {
  it('uses input_text for system and user turns', () => {
    expect(timeoutPolicy.resolveResponsesContentTypeForRole('system')).toBe('input_text');
    expect(timeoutPolicy.resolveResponsesContentTypeForRole('user')).toBe('input_text');
  });

  it('uses output_text for assistant turns', () => {
    expect(timeoutPolicy.resolveResponsesContentTypeForRole('assistant')).toBe('output_text');
  });
});

describe('shouldUseResponsesApiForToolLoop', () => {
  it('enables Responses tool loop for OpenAI GPT-5 models', () => {
    const config: LlmConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
    };

    expect(timeoutPolicy.shouldUseResponsesApiForToolLoop(config, 'gpt-5')).toBe(true);
    expect(timeoutPolicy.shouldUseResponsesApiForToolLoop(config, 'gpt-5-mini')).toBe(true);
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

    expect(timeoutPolicy.shouldUseResponsesApiForToolLoop(openAiCompatible, 'gpt-5')).toBe(false);
    expect(timeoutPolicy.shouldUseResponsesApiForToolLoop(copilot, 'gpt-5')).toBe(false);
    expect(
      timeoutPolicy.shouldUseResponsesApiForToolLoop(
        { ...openAiCompatible, baseUrl: 'https://api.openai.com/v1' },
        'gpt-4o'
      )
    ).toBe(false);
  });
});

describe('buildRuntimeToolEvidence', () => {
  it('serializes successful tool output with direct provenance', () => {
    const evidence = toolEvidenceBuilder.buildRuntimeToolEvidence(
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
    const evidence = toolEvidenceBuilder.buildRuntimeToolEvidence(
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

describe('history conversion', () => {
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

    const converted = (messages as Array<{
      from: string;
      content: string;
      archived?: boolean;
      hiddenFromLlm?: boolean;
    }>)
      .filter((msg) => !msg.archived && !msg.hiddenFromLlm)
      .map((msg) => ({
        role: msg.from === 'human' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));

    expect(converted).toEqual([{ role: 'user', content: 'keep this' }]);
  });
});
