import { describe, expect, it } from 'vitest';
import { resolveEffectiveLlmSettings } from './index.js';

describe('resolveEffectiveLlmSettings', () => {
  it('applies precedence: team default -> skill -> agent -> runtime options', () => {
    const teamConfig = {
      version: '1',
      providers: {
        copilot: {
          kind: 'github-copilot',
          isDefault: true,
          defaultModelKey: 'smart',
          models: {
            fast: 'gpt-4o-mini',
            smart: 'gpt-4o',
            ultra: 'claude-sonnet-4.6',
          },
          params: {
            temperature: 0.1,
            maxTokens: 100,
            topP: 0.9,
          },
        },
      },
    } as any;

    const skill = {
      llm: {
        modelKey: 'fast',
        params: {
          temperature: 0.2,
          presencePenalty: 0.3,
        },
      },
    } as any;

    const agent = {
      llm: {
        modelKey: 'ultra',
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

    const resolved = resolveEffectiveLlmSettings(teamConfig, agent, skill, runtimeOptions);

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

  it('throws when modelKey is missing in provider models dictionary', () => {
    const teamConfig = {
      version: '1',
      providers: {
        copilot: {
          kind: 'github-copilot',
          isDefault: true,
          models: {
            safe: 'gpt-4o-mini',
          },
        },
      },
    } as any;

    const agent = {
      llm: {
        modelKey: 'not-found',
      },
    } as any;

    expect(() => resolveEffectiveLlmSettings(teamConfig, agent)).toThrow(
      "Model key 'not-found' was not found in provider 'copilot' models dictionary.",
    );
  });
});