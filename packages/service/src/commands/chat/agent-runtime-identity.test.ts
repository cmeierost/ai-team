import { describe, expect, it, vi } from 'vitest';
import { AgentRuntimeIdentityResolver } from './agent-runtime-identity.js';

describe('AgentRuntimeIdentityResolver', () => {
  it('attaches the effective model while preserving the loaded agent document', () => {
    const agent = {
      id: 'michael-brown',
      name: 'Michael Brown',
      llm: { modelKey: 'cheap' },
    } as any;
    const resolver = new AgentRuntimeIdentityResolver(
      { get: vi.fn(() => ({ defaultModel: { provider: 'openai', model: 'gpt-5' } })) },
      {
        resolveEffectiveLlmSettings: vi.fn(() => ({
          config: { provider: 'openai', model: 'gpt-5-mini' },
          options: {},
          providerRef: 'openai',
          contextWindow: 128000,
        })),
      }
    );

    const resolved = resolver.resolve(agent);

    expect(resolved).not.toBe(agent);
    expect(resolved.resolvedLlm).toEqual({
      providerRef: 'openai',
      model: 'gpt-5-mini',
      contextWindow: 128000,
      isDefault: false,
    });
    expect(agent.resolvedLlm).toBeUndefined();
  });
});
