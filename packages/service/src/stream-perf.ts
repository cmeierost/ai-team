import { writeBackendDebugLog } from './utils/debug-log.js';

export function parseStreamPerfEnv() {
  const v = process.env.AI_TEAM_STREAM_PERF?.trim().toLowerCase();
  const enabled = !!v && v !== '0' && v !== 'false' && v !== 'off';
  const slowMs = Math.max(1, Number(process.env.AI_TEAM_STREAM_PERF_SLOW_EVENT_MS ?? '10') || 10);
  return { enabled, slowMs };
}

export function createStreamPerfTracker(
  workspaceRoot: string,
  command: string,
  requestId: string | undefined,
  slowThresholdMs: number,
) {
  const nowNs = () => process.hrtime.bigint();
  const elapsedMs = (start: bigint) => Number(nowNs() - start) / 1_000_000;
  const state = {
    startedAt: Date.now(),
    runtimeEventsQueued: 0,
    runtimeEventsDequeued: 0,
    streamEventsYielded: 0,
    queueWaitMs: 0,
    emitRuntimeWriteLogMs: 0,
    emitRuntimeLoggerMs: 0,
    toStreamWriteLogMs: 0,
    toStreamLoggerMs: 0,
    toStreamTotalMs: 0,
    slowToStreamEventCount: 0,
    maxToStreamEventMs: 0,
    maxToStreamEventKind: '' as string,
    byKind: {} as Record<string, number>,
  };
  const logSlowEvent = (eventKind: string, durationMs: number) => {
    if (durationMs < slowThresholdMs) return;
    writeBackendDebugLog(workspaceRoot, {
      source: 'stream-perf',
      phase: 'slow-to-stream-event',
      command,
      requestId,
      kind: eventKind,
      durationMs,
    });
  };
  const flush = (reason: 'done' | 'aborted' | 'error') => {
    writeBackendDebugLog(workspaceRoot, {
      source: 'stream-perf',
      phase: 'summary',
      reason,
      command,
      requestId,
      totalMs: Date.now() - state.startedAt,
      slowThresholdMs,
      stats: state,
    });
  };
  return { state, slowThresholdMs, nowNs, elapsedMs, logSlowEvent, flush };
}
