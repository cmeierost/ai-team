import { describe, expect, it } from 'vitest';
import { InfrastructureBackendDebugLogSettingsService } from './infrastructure-backend-debug-log-settings-service.js';

function createStorage(overrides?: {
  file?: 'off' | 'error' | 'warning' | 'info' | 'debug';
  console?: 'off' | 'error' | 'warning' | 'info' | 'debug';
  targets?: {
    console?: {
      file?: 'off' | 'error' | 'warning' | 'info' | 'debug';
      console?: 'off' | 'error' | 'warning' | 'info' | 'debug';
    };
    api?: {
      file?: 'off' | 'error' | 'warning' | 'info' | 'debug';
      console?: 'off' | 'error' | 'warning' | 'info' | 'debug';
    };
  };
}): { get: (path: string) => unknown } {
  const config = {
    log: {
      backend: {
        file: 'off' as const,
        console: 'off' as const,
        ...(overrides ?? {}),
      },
    },
  };

  return {
    get(path: string) {
      if (path === 'log.backend') {
        return config.log.backend;
      }
      throw new Error(`Unsupported path: ${path}`);
    },
  };
}

describe('InfrastructureBackendDebugLogSettingsService', () => {
  it('persists backend errors by default when no logging target is configured', () => {
    const service = new InfrastructureBackendDebugLogSettingsService({
      get: () => ({}),
    } as any);

    expect(service.resolveForRuntime('console')).toMatchObject({
      file: 'error',
      console: 'off',
    });
    expect(service.resolveForRuntime('api')).toMatchObject({
      file: 'error',
      console: 'off',
    });
  });

  it('returns base backend settings when no target overrides exist', () => {
    const service = new InfrastructureBackendDebugLogSettingsService(
      createStorage({ file: 'warning', console: 'off' }) as any
    );

    expect(service.resolveForRuntime('console')).toMatchObject({
      file: 'warning',
      console: 'off',
      sources: { 'workflow-runner': 'error' },
    });
    expect(service.resolveForRuntime('api')).toMatchObject({
      file: 'warning',
      console: 'off',
      sources: { 'workflow-runner': 'error' },
    });
  });

  it('applies console target overrides on top of backend defaults', () => {
    const service = new InfrastructureBackendDebugLogSettingsService(
      createStorage({
        file: 'info',
        console: 'off',
        targets: {
          console: { console: 'debug' },
        },
      }) as any
    );

    expect(service.resolveForRuntime('console')).toMatchObject({
      file: 'info',
      console: 'debug',
      sources: { 'workflow-runner': 'error' },
    });
  });

  it('applies api target overrides without affecting console target', () => {
    const service = new InfrastructureBackendDebugLogSettingsService(
      createStorage({
        file: 'off',
        console: 'off',
        targets: {
          api: { file: 'warning' },
        },
      }) as any
    );

    expect(service.resolveForRuntime('api')).toMatchObject({
      file: 'warning',
      console: 'off',
      sources: { 'workflow-runner': 'error' },
    });

    expect(service.resolveForRuntime('console')).toMatchObject({
      file: 'off',
      console: 'off',
      sources: { 'workflow-runner': 'error' },
    });
  });

  it('preserves per-source level overrides', () => {
    const service = new InfrastructureBackendDebugLogSettingsService(
      createStorage({
        file: 'off',
        console: 'off',
        sources: {
          'workflow-runner': 'debug',
        },
      }) as any
    );

    expect(service.resolveForRuntime('console')).toMatchObject({
      file: 'off',
      console: 'off',
      sources: {
        'workflow-runner': 'debug',
      },
    });
  });
});
