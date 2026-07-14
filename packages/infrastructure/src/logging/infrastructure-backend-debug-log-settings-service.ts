import type {
  BackendDebugLogSettings,
  BackendLogRuntimeProfile,
  IConfigurationStorage,
} from '@ai-team/core';

const DEFAULT_SETTINGS: BackendDebugLogSettings = {
  file: 'off',
  console: 'off',
};

type PartialSettings = Partial<BackendDebugLogSettings> | undefined;

export class InfrastructureBackendDebugLogSettingsService {
  constructor(private readonly configurationStorage: Pick<IConfigurationStorage, 'get'>) {}

  resolveForRuntime(profile: BackendLogRuntimeProfile): BackendDebugLogSettings {
    try {
      const backend = this.configurationStorage.get('log.backend') as {
        file?: BackendDebugLogSettings['file'];
        console?: BackendDebugLogSettings['console'];
        targets?: {
          console?: PartialSettings;
          api?: PartialSettings;
        };
      };

      const base: BackendDebugLogSettings = {
        file: backend?.file ?? DEFAULT_SETTINGS.file,
        console: backend?.console ?? DEFAULT_SETTINGS.console,
      };

      const runtimeOverrides =
        profile === 'api' ? backend?.targets?.api : backend?.targets?.console;
      return {
        file: runtimeOverrides?.file ?? base.file,
        console: runtimeOverrides?.console ?? base.console,
      };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
}
