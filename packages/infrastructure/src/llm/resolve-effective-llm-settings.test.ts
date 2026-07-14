import { describe, expect, it } from 'vitest';
import { ProviderConfigurationService } from './provider-configuration.service.js';
import { InfrastructureLlmSettingsResolver } from './llm-settings-resolver.js';

describe('resolveEffectiveLlmSettings', () => {
  const createResolver = (teamConfig: any) =>
    new InfrastructureLlmSettingsResolver(new ProviderConfigurationService(teamConfig));

  it('applies precedence: team default -> skill -> agent -> runtime options', () => {
    const teamConfig = {
      version: '1',
      providers: {
        copilot: {
          kind: 'github-copilot',
          models: [{ name: 'gpt-4o-mini' }, { name: 'gpt-4o' }, { name: 'claude-sonnet-4.6' }],
          params: {
            temperature: 0.1,
            maxTokens: 100,
            topP: 0.9,
          },
        },
      },
      defaultModel: { provider: 'copilot', model: 'gpt-4o' },
    } as any;

    const skill = {
      llm: {
        modelKey: 'gpt-4o-mini',
        params: {
          temperature: 0.2,
          presencePenalty: 0.3,
        },
      },
    } as any;

    const agent = {
      llm: {
        modelKey: 'claude-sonnet-4.6',
        params: {
          maxTokens: 400,
          frequencyPenalty: 0.5,
        },
      },
    } as any;

    const runtimeOptions = {
      temperature: 0.7,
      maxTokens: 900,
      stop: ['END'],
    } as any;

    const resolver = createResolver(teamConfig);
    const resolved = resolver.resolveEffectiveLlmSettings(teamConfig, agent, skill, runtimeOptions);

    expect(resolved.providerRef).toBe('copilot');
    expect(resolved.config.provider).toBe('github-copilot');
    expect(resolved.config.model).toBe('claude-sonnet-4.6');
    expect(resolved.config.params).toEqual({
      temperature: 0.2,
      maxTokens: 400,
      topP: 0.9,
      presencePenalty: 0.3,
      frequencyPenalty: 0.5,
    });
    expect(resolved.options).toEqual({
      temperature: 0.7,
      maxTokens: 900,
      topP: 0.9,
      presencePenalty: 0.3,
      frequencyPenalty: 0.5,
      stop: ['END'],
    });
  });

  it('falls back to provider default model when modelKey is missing', () => {
    const teamConfig = {
      version: '1',
      providers: {
        copilot: {
          kind: 'github-copilot',
          defaultModel: 'gpt-4o-mini',
          models: [{ name: 'gpt-4o-mini' }],
        },
      },
      defaultModel: { provider: 'copilot', model: 'gpt-4o-mini' },
    } as any;

    const agent = {
      llm: {
        modelKey: 'not-found',
      },
    } as any;

    const resolver = createResolver(teamConfig);
    const resolved = resolver.resolveEffectiveLlmSettings(teamConfig, agent);
    expect(resolved.config.model).toBe('gpt-4o-mini');
  });

  it('resolves named team modelKeys before provider-local model lookup', () => {
    const teamConfig = {
      version: '1',
      providers: {
        copilot: {
          kind: 'github-copilot',
          defaultModel: 'gpt-4o-mini',
          models: [{ name: 'gpt-4o-mini' }],
        },
        openai: {
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4.1-mini',
          apiKey: '${OPENAI_API_KEY}',
          models: [{ name: 'gpt-4.1-mini' }],
        },
      },
      defaultModel: { provider: 'openai', model: 'gpt-4.1-mini' },
      modelKeys: {
        fast: {
          provider: 'openai',
          model: 'gpt-4.1-mini',
        },
      },
    } as any;

    const agent = {
      llm: {
        modelKey: 'fast',
      },
    } as any;

    const resolver = createResolver(teamConfig);
    const resolved = resolver.resolveEffectiveLlmSettings(teamConfig, agent);

    expect(resolved.providerRef).toBe('openai');
    expect(resolved.config.provider).toBe('openai-compatible');
    expect(resolved.config.model).toBe('gpt-4.1-mini');
    expect(resolved.config.apiKey).toBe('${OPENAI_API_KEY}');
  });

  it('falls back to provider-local model lookup when explicit provider conflicts with named modelKey provider', () => {
    const teamConfig = {
      version: '1',
      providers: {
        copilot: {
          kind: 'github-copilot',
          defaultModel: 'gpt-4o',
          models: [{ name: 'gpt-4o-mini' }, { name: 'gpt-4o' }],
        },
        openai: {
          kind: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          defaultModel: 'gpt-5-mini',
          models: [{ name: 'gpt-5-mini' }],
        },
      },
      defaultModel: { provider: 'copilot', model: 'gpt-4o' },
      modelKeys: {
        'gpt-4o-mini': {
          provider: 'openai',
          model: 'gpt-5-mini',
        },
      },
    } as any;

    const agent = {
      llm: {
        provider: 'copilot',
        modelKey: 'gpt-4o-mini',
      },
    } as any;

    const resolver = createResolver(teamConfig);
    const resolved = resolver.resolveEffectiveLlmSettings(teamConfig, agent);

    expect(resolved.providerRef).toBe('copilot');
    expect(resolved.config.provider).toBe('github-copilot');
    expect(resolved.config.model).toBe('gpt-4o-mini');
  });
});
