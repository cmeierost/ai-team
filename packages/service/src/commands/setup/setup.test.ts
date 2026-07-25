import { describe, expect, it } from 'vitest';
import { SetupCommand } from './setup.js';

describe('SetupCommand provider registration', () => {
  const buildRegistration = (setup: Record<string, unknown>) =>
    (SetupCommand as any).buildProviderRegistrationFromSetup(setup);

  it('preserves the selected custom provider key and secret reference', () => {
    expect(
      buildRegistration({
        provider: 'openai-compatible',
        providerRef: 'llm-hub',
        baseUrl: 'https://api.llmhub.infs.ai/v1',
        model: 'best-chat',
        apiKey: 'secret-value',
      })
    ).toEqual({
      providerRef: 'llm-hub',
      providerEntry: {
        kind: 'openai-compatible',
        baseUrl: 'https://api.llmhub.infs.ai/v1',
        defaultModel: 'best-chat',
        models: [{ name: 'best-chat' }],
        apiKey: '${LLM_HUB_API_KEY}',
      },
      defaultModel: {
        provider: 'llm-hub',
        model: 'best-chat',
      },
    });
  });

  it('does not invent a personal-openai provider for a custom endpoint', () => {
    expect(() =>
      buildRegistration({
        provider: 'openai-compatible',
        baseUrl: 'https://api.llmhub.infs.ai/v1',
        model: 'best-chat',
        apiKey: 'secret-value',
      })
    ).toThrow(/require an explicit provider key/i);
  });

  it('preserves providerRef when keeping an existing connection', async () => {
    const command = new SetupCommand(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { confirm: async () => false } as any,
      { log: () => undefined } as any
    );

    await expect(
      (command as any).resolveLlmConfig(undefined, {
        providerRef: 'llm-hub',
        config: {
          provider: 'openai-compatible',
          baseUrl: 'https://api.llmhub.infs.ai/v1',
          model: 'best-chat',
          apiKey: 'resolved-secret',
        },
        options: {},
      })
    ).resolves.toEqual({
      reusedExistingLlm: true,
      llmConfig: {
        providerRef: 'llm-hub',
        provider: 'openai-compatible',
        baseUrl: 'https://api.llmhub.infs.ai/v1',
        model: 'best-chat',
        apiKey: 'resolved-secret',
      },
    });
  });
});
