import type { ExtensionManifest, NormalizedToolEvent, ToolRenderDecision } from './types.js';
import {
  AskResult,
  FileTreeResult,
  RunCommandResult,
  SlashCommandResult,
} from '../tui/tool-results.js';

export function createDefaultToolRendererManifest(): ExtensionManifest {
  const completedAskCalls = new Set<string>();
  const streamingRunCalls = new Map<string, RunCommandResult>();
  return {
    name: 'cli-default-tool-renderers',
    toolRenderers: [
      {
        toolName: 'com_ask',
        render: (event) => renderAsk(event, completedAskCalls),
      },
      {
        toolName: 'fs_tree',
        render: (event) => terminalTranscriptResult(event, new FileTreeResult(
          event.error ?? event.output
        )),
      },
      {
        toolName: 'slash:run',
        render: (event) => renderStreamingRun(event, streamingRunCalls),
      },
      {
        toolName: 'cli_run',
        render: (event) => renderStreamingRun(event, streamingRunCalls),
      },
      {
        toolName: 'slash:*',
        render: (event) => terminalTranscriptResult(event, new SlashCommandResult(
          event.error ?? event.output
        )),
      },
    ],
  };
}

function renderStreamingRun(
  event: NormalizedToolEvent,
  activeCalls: Map<string, RunCommandResult>
): ToolRenderDecision {
  if (event.historical || !event.callId) {
    return terminalTranscriptResult(
      event,
      new RunCommandResult(formatTerminalValue(event.error ?? event.output))
    );
  }

  const update = asCommandOutputUpdate(event.output);
  if (event.phase === 'start' && update) {
    const existing = activeCalls.get(event.callId);
    if (existing) {
      existing.append(update.text);
      return { handled: true, placements: [] };
    }

    const component = new RunCommandResult();
    component.append(update.text);
    activeCalls.set(event.callId, component);
    return {
      handled: true,
      placements: [{ target: 'transcript', component }],
    };
  }

  if (
    event.phase === 'result'
    || event.phase === 'error'
    || event.phase === 'denied'
  ) {
    const existing = activeCalls.get(event.callId);
    if (existing) {
      existing.complete(formatTerminalValue(event.error ?? event.output));
      activeCalls.delete(event.callId);
      return { handled: true, placements: [] };
    }
  }

  return terminalTranscriptResult(
    event,
    new RunCommandResult(formatTerminalValue(event.error ?? event.output))
  );
}

function asCommandOutputUpdate(value: unknown): { text: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (
    record['type'] !== 'command_output_start'
    && record['type'] !== 'command_output_delta'
  ) {
    return undefined;
  }
  return typeof record['text'] === 'string' ? { text: record['text'] } : undefined;
}

function formatTerminalValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderAsk(
  event: NormalizedToolEvent,
  completedCalls: Set<string>
): ToolRenderDecision {
  if (event.phase === 'request' || event.phase === 'start') {
    return { handled: true, placements: [] };
  }

  if (!event.historical && event.callId) {
    if (completedCalls.has(event.callId)) {
      return { handled: true, placements: [] };
    }
    completedCalls.add(event.callId);
  }

  return terminalTranscriptResult(
    event,
    new AskResult(
      event.request,
      event.output,
      event.phase === 'error' || event.phase === 'denied'
        ? (event.error ?? event.denial ?? event.output)
        : undefined
    )
  );
}

function terminalTranscriptResult(
  event: NormalizedToolEvent,
  component: import('@ai-team/tui').Component
): ToolRenderDecision {
  if (
    event.phase !== 'result'
    && event.phase !== 'error'
    && event.phase !== 'denied'
  ) {
    return { handled: true, placements: [] };
  }
  return {
    handled: true,
    placements: [{ target: 'transcript', component }],
  };
}
