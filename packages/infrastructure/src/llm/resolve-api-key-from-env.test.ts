import { describe, expect, it } from 'vitest';
import { buildApiKeyResolutionDiagnostics, resolveApiKeyFromEnv } from './index.js';

describe('resolveApiKeyFromEnv', () => {
  it('uses preferred env var when present', () => {
    const resolved = resolveApiKeyFromEnv(
      {
        CUSTOM_PROVIDER_KEY: 'abc123',
        AI_TEAM_LLM_API_KEY: 'fallback',
      },
      'CUSTOM_PROVIDER_KEY'
    );

    expect(resolved.preferredEnvVar).toBe('CUSTOM_PROVIDER_KEY');
    expect(resolved.foundPreferred).toBe(true);
    expect(resolved.selectedEnvVar).toBe('CUSTOM_PROVIDER_KEY');
    expect(resolved.apiKey).toBe('abc123');
    expect(resolved.lookupOrder).toEqual([
      'CUSTOM_PROVIDER_KEY',
      'AI_TEAM_LLM_API_KEY',
      'LLM_API_KEY',
      'OPENAI_API_KEY',
    ]);
  });

  it('falls back when preferred env var is missing', () => {
    const resolved = resolveApiKeyFromEnv(
      {
        LLM_API_KEY: 'fallback-key',
      },
      'CUSTOM_PROVIDER_KEY'
    );

    expect(resolved.preferredEnvVar).toBe('CUSTOM_PROVIDER_KEY');
    expect(resolved.foundPreferred).toBe(false);
    expect(resolved.selectedEnvVar).toBe('LLM_API_KEY');
    expect(resolved.apiKey).toBe('fallback-key');
  });

  it('returns undefined when no known env var is present', () => {
    const resolved = resolveApiKeyFromEnv({}, 'CUSTOM_PROVIDER_KEY');

    expect(resolved.preferredEnvVar).toBe('CUSTOM_PROVIDER_KEY');
    expect(resolved.foundPreferred).toBe(false);
    expect(resolved.selectedEnvVar).toBeUndefined();
    expect(resolved.apiKey).toBeUndefined();
  });

  it('emits preferred-key-missing diagnostic when fallback is used', () => {
    const resolved = resolveApiKeyFromEnv(
      {
        LLM_API_KEY: 'fallback-key',
      },
      'CUSTOM_PROVIDER_KEY'
    );

    const diagnostics = buildApiKeyResolutionDiagnostics(resolved, {
      provider: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
    });

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ level: 'warn' });
    expect(diagnostics[0]?.message).toContain("Preferred API key env var 'CUSTOM_PROVIDER_KEY'");
    expect(diagnostics[0]?.message).toContain("Using fallback 'LLM_API_KEY'");
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
