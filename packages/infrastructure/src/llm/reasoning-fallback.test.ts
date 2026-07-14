import { describe, expect, it } from 'vitest';
import type { LlmConfig } from '@ai-team/core';
import { LlmProviderNormalizationService } from './llm-provider-normalization.js';

const normalizationService = new LlmProviderNormalizationService();

describe('reasoning-only completion fallback', () => {
  it('detects reasoning-only chat completions', () => {
    const response = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            reasoning: 'Thinking Process: ...',
          },
          finish_reason: 'length',
        },
      ],
    };

    expect(normalizationService.hasReasoningOnlyCompletion(response)).toBe(true);
  });

  it('does not detect reasoning-only when normal content exists', () => {
    const response = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: '["John Smith","Emily Davis"]',
            reasoning: 'Thinking Process: ...',
          },
          finish_reason: 'stop',
        },
      ],
    };

    expect(normalizationService.hasReasoningOnlyCompletion(response)).toBe(false);
  });

  it('builds fallback request with enable_thinking=false for openai-compatible', () => {
    const config: LlmConfig = {
      provider: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      model: 'qwen-model',
    };

    const request = {
      model: 'qwen-model',
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 120,
      chat_template_kwargs: {
        some_other_flag: true,
      },
    };

    const response = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            reasoning: 'Thinking Process: ...',
          },
          finish_reason: 'length',
        },
      ],
    };

    expect(
      normalizationService.buildDisableThinkingFallbackRequest(config, request, response)
    ).toEqual({
      ...request,
      chat_template_kwargs: {
        some_other_flag: true,
        enable_thinking: false,
      },
    });
  });

  it('does not build fallback request for non-openai-compatible providers', () => {
    const config: LlmConfig = {
      provider: 'github-copilot',
      model: 'gpt-4o',
    };

    const request = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hello' }],
    };

    const response = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            reasoning: 'Thinking Process: ...',
          },
          finish_reason: 'length',
        },
      ],
    };

    expect(
      normalizationService.buildDisableThinkingFallbackRequest(config, request, response)
    ).toBeUndefined();
  });
});
