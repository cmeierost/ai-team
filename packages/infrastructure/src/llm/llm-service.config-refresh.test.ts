import { describe, expect, it, vi } from 'vitest';
import type { TeamConfig } from '@ai-team/core';
import { LlmService } from './llm-service.js';

describe('LlmService configuration refresh', () => {
  it('reads the latest TeamConfig when initialized after setup', async () => {
    const initialConfig = { version: '1' } as TeamConfig;
    const configured = {
      version: '1',
      providers: {
        'llm-hub': {
          kind: 'openai-compatible',
          baseUrl: 'https://api.llmhub.infs.ai/v1',
          defaultModel: 'best-chat',
          apiKey: 'test-key',
        },
      },
      defaultModel: {
        provider: 'llm-hub',
        model: 'best-chat',
      },
    } as TeamConfig;
    let currentConfig = initialConfig;
    const resolveEffectiveLlmSettings = vi.fn((teamConfig: TeamConfig) => {
      expect(teamConfig).toBe(configured);
      return {
        providerRef: 'llm-hub',
        config: {
          provider: 'openai-compatible',
          baseUrl: 'https://api.llmhub.infs.ai/v1',
          model: 'best-chat',
          apiKey: 'test-key',
        },
        options: {},
      };
    });
    const service = new LlmService(
      'C:/workspace',
      () => currentConfig,
      { resolveEffectiveLlmSettings } as any,
      { write: vi.fn() } as any
    );

    currentConfig = configured;
    await service.initialize();

    expect(resolveEffectiveLlmSettings).toHaveBeenCalledOnce();
    expect(service.modelName).toBe('best-chat');
    expect(service.providerName).toBe('llm-hub');
  });
});
