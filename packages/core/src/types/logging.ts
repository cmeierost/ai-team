import type { LogDestinationLevel } from './schemas.js';

export type BackendLogRuntimeProfile = 'console' | 'api';

export interface BackendDebugLogSettings {
  file: LogDestinationLevel;
  console: LogDestinationLevel;
}

export interface IBackendDebugLogSettingsService {
  resolveForRuntime(profile: BackendLogRuntimeProfile): BackendDebugLogSettings;
}

export interface IBackendLogService {
  write(entry: unknown): void;
}

export type BackendLogSettings = BackendDebugLogSettings;
export type IBackendLogSettingsService = IBackendDebugLogSettingsService;
