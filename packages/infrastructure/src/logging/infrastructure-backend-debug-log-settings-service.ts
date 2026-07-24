import type {
  BackendDebugLogSettings,
  BackendLogRuntimeProfile,
  IConfigurationStorage,
  IBackendDebugLogSettingsService,
} from '@ai-team/core';

const DEFAULT_SETTINGS: BackendDebugLogSettings = {
  // Errors must remain diagnosable even when a workspace has not opted into
  // verbose backend logging. Higher-volume levels remain explicitly opt-in.
  file: 'error',
  console: 'off',
  sources: {
    // Workflow runner emits a debug event for every state transition and step
    // boundary. Keep that noise disabled while retaining terminal failures.
    'workflow-runner': 'error',
  },
};

type PartialSettings = Partial<BackendDebugLogSettings> | undefined;

export class InfrastructureBackendDebugLogSettingsService implements IBackendDebugLogSettingsService {
  constructor(private readonly configurationStorage: Pick<IConfigurationStorage, 'get'>) {}

  resolveForRuntime(profile: BackendLogRuntimeProfile): BackendDebugLogSettings {
    try {
      const backend = this.configurationStorage.get('log.backend') as {
        file?: BackendDebugLogSettings['file'];
        console?: BackendDebugLogSettings['console'];
        sources?: BackendDebugLogSettings['sources'];
        retentionHours?: BackendDebugLogSettings['retentionHours'];
        retentionDays?: BackendDebugLogSettings['retentionDays'];
        targets?: {
          console?: PartialSettings;
          api?: PartialSettings;
        };
      };

      const base: BackendDebugLogSettings = {
        file: backend?.file ?? DEFAULT_SETTINGS.file,
        console: backend?.console ?? DEFAULT_SETTINGS.console,
        sources: backend?.sources ?? DEFAULT_SETTINGS.sources,
        retentionHours: backend?.retentionHours,
        retentionDays: backend?.retentionDays ?? 7,
      };

      const runtimeOverrides =
        profile === 'api' ? backend?.targets?.api : backend?.targets?.console;
      return {
        file: runtimeOverrides?.file ?? base.file,
        console: runtimeOverrides?.console ?? base.console,
        sources: base.sources,
        retentionHours: base.retentionHours,
        retentionDays: base.retentionDays,
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
}
