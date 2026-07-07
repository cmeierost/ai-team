import { describe, expect, it } from 'vitest';
import { buildApiKeyResolutionDiagnostics, resolveApiKeyFromEnv } from './index.js';

describe('resolveApiKeyFromEnv', () => {
  it('uses preferred env var when present', () => {
    const resolved = resolveApiKeyFromEnv(
      {
        CUSTOM_PROVIDER_KEY: 'abc123',
      },
      'CUSTOM_PROVIDER_KEY'
    );

    expect(resolved.preferredEnvVar).toBe('CUSTOM_PROVIDER_KEY');
    expect(resolved.foundPreferred).toBe(true);
    expect(resolved.selectedEnvVar).toBe('CUSTOM_PROVIDER_KEY');
    expect(resolved.apiKey).toBe('abc123');
    expect(resolved.lookupOrder).toEqual(['CUSTOM_PROVIDER_KEY']);
  });

  it('returns undefined when preferred env var is missing', () => {
    const resolved = resolveApiKeyFromEnv(
      {
        OTHER_KEY: 'some-value',
      },
      'CUSTOM_PROVIDER_KEY'
    );

    expect(resolved.preferredEnvVar).toBe('CUSTOM_PROVIDER_KEY');
    expect(resolved.foundPreferred).toBe(false);
    expect(resolved.selectedEnvVar).toBeUndefined();
    expect(resolved.apiKey).toBeUndefined();
  });

  it('returns undefined when no known env var is present', () => {
    const resolved = resolveApiKeyFromEnv({}, 'CUSTOM_PROVIDER_KEY');

    expect(resolved.preferredEnvVar).toBe('CUSTOM_PROVIDER_KEY');
    expect(resolved.foundPreferred).toBe(false);
    expect(resolved.selectedEnvVar).toBeUndefined();
    expect(resolved.apiKey).toBeUndefined();
  });

  it('emits missing-key diagnostic for non-local openai-compatible provider', () => {
    const resolved = resolveApiKeyFromEnv({}, 'CUSTOM_PROVIDER_KEY');

    const diagnostics = buildApiKeyResolutionDiagnostics(
      resolved,
      {
        provider: 'openai-compatible',
        baseUrl: 'https://api.example.com/v1',
      },
      'my-provider'
    );

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'warn' });
    expect(diagnostics[0]?.message).toContain("API key not found for provider 'my-provider'");
  });

  it('does not emit missing-key diagnostic for localhost providers', () => {
    const resolved = resolveApiKeyFromEnv({}, 'CUSTOM_PROVIDER_KEY');

    const diagnostics = buildApiKeyResolutionDiagnostics(resolved, {
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
    });

    expect(diagnostics).toEqual([]);
  });
});
