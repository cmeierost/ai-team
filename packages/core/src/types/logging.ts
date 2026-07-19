import type { LogDestinationLevel } from './schemas.js';

export type BackendLogRuntimeProfile = 'console' | 'api';

export interface BackendDebugLogSettings {
  file: LogDestinationLevel;
  console: LogDestinationLevel;
  /** Per-source level overrides — when a source is listed, its level takes precedence over the global level. */
  sources?: Record<string, LogDestinationLevel>;
  /** Max age in hours before log files are deleted. Takes precedence over retentionDays. */
  retentionHours?: number;
  /** Max age in days before log files are deleted. Default 7. Ignored if retentionHours is set. */
  retentionDays?: number;
}

export interface IBackendDebugLogSettingsService {
  resolveForRuntime(profile: BackendLogRuntimeProfile): BackendDebugLogSettings;
}

export interface IBackendLogService {
  write(entry: unknown): void;
}

export type BackendLogSettings = BackendDebugLogSettings;
export type IBackendLogSettingsService = IBackendDebugLogSettingsService;
