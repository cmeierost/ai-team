import { getSelectedServerUrl } from './server-connections';

function normalizeApiBaseUrl(value: string): string {
  return value.replace(/\/$/, '');
}

function getQueryApiBase(): string | undefined {
  if (typeof globalThis === 'undefined' || !globalThis.location) {
    return undefined;
  }

  const params = new URLSearchParams(globalThis.location.search);
  const queryValue = params.get('apiBase') ?? params.get('apiUrl');

  if (!queryValue || queryValue.trim().length === 0) {
    return undefined;
  }

  return normalizeApiBaseUrl(queryValue.trim());
}

function getEnvApiBase(): string | undefined {
  const value = import.meta.env.VITE_AI_TEAM_API_BASE;
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  return normalizeApiBaseUrl(value.trim());
}

export function hasStartupApiBaseOverride(): boolean {
  return Boolean(getQueryApiBase() || getEnvApiBase());
}

export function resolveApiBase(): string {
  const queryOverride = getQueryApiBase();
  if (queryOverride) {
    return queryOverride;
  }

  const envOverride = getEnvApiBase();
  if (envOverride) {
    return envOverride;
  }

  const savedSelection = getSelectedServerUrl();
  if (savedSelection) {
    return savedSelection;
  }

  if (globalThis.location.hostname === 'localhost') {
    return 'http://localhost:3002';
  }

  return globalThis.location.origin;
}

export const API_BASE = resolveApiBase();
