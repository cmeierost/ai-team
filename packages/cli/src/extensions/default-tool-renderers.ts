import type { ExtensionManifest, NormalizedToolEvent, ToolRenderDecision } from './types.js';
import {
  AskResult,
  FileTreeResult,
  RunCommandResult,
  SlashCommandResult,
} from '../tui/tool-results.js';
import { ToolEvent } from '../tui/tool-event.js';

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
        toolName: 'com_handoff',
        render: (event) => renderHandoff(event),
      },
      {
        toolName: 'fs_tree',
        render: (event) => terminalTranscriptResult(event, new FileTreeResult(
          event.error ?? event.output
        )),
      },
      {
        toolName: 'fs_read',
        render: (event) => renderReadResult(event),
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

function renderReadResult(event: NormalizedToolEvent): ToolRenderDecision {
  if (
    event.phase !== 'result'
    && event.phase !== 'error'
    && event.phase !== 'denied'
  ) {
    // Leave request/start events to the standard ToolEvent renderer so the
    // request and result remain separate transcript entries.
    return { handled: false, placements: [] };
  }

  return terminalTranscriptResult(
    event,
    new ToolEvent(
      'fs_read',
      undefined,
      formatReadOutput(event.error ?? event.output),
      event.phase,
      { maxInputLines: 4, maxOutputLines: 24 }
    )
  );
}

function formatReadOutput(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const result = value as Record<string, unknown>;
  if (typeof result['content'] !== 'string') return value;

  const path = typeof result['path'] === 'string' ? result['path'] : 'file';
  const startLine = typeof result['startLine'] === 'number' ? result['startLine'] : undefined;
  const endLine = typeof result['endLine'] === 'number' ? result['endLine'] : undefined;
  const scope = result['isFullFile'] === true ? 'full-file' : 'partial-slice';
  const range = startLine !== undefined && endLine !== undefined
    ? ` lines ${startLine}-${endLine}`
    : '';
  return `File: ${path}\nScope: ${scope}${range}\n\n${result['content']}`;
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

function renderHandoff(event: NormalizedToolEvent): ToolRenderDecision {
  if (event.phase !== 'result' && event.phase !== 'error' && event.phase !== 'denied') {
    return { handled: false, placements: [] };
  }

  // Handoff output contains the routing contract and briefing note. It is
  // materially useful context, so do not apply the generic historical
  // eight-line preview limit that is appropriate for routine tool output.
  return terminalTranscriptResult(
    event,
    new ToolEvent('com_handoff', undefined, event.error ?? event.output, event.phase)
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
