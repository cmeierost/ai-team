import { describe, expect, it } from 'vitest';
import type { TeamConfig } from '@ai-team/core';
import { ProviderConfigurationService } from './provider-configuration.service.js';

describe('ProviderConfigurationService configuration refresh', () => {
  it('resolves a default provider added after the service was constructed', () => {
    let config = { version: '1' } as TeamConfig;
    const service = new ProviderConfigurationService(() => config);

    config = {
      version: '1',
      providers: {
        'llm-hub': {
          kind: 'openai-compatible',
          defaultModel: 'best-chat',
        },
      },
      defaultModel: {
        provider: 'llm-hub',
        model: 'best-chat',
      },
    } as TeamConfig;

    expect(service.resolveDefaultProviderRef()).toBe('llm-hub');
    expect(service.resolveDefaultProvider()).toEqual({
      ref: 'llm-hub',
      config: config.providers!['llm-hub'],
    });
  });
});
