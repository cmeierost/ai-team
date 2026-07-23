import type { ExtensionManifest, NormalizedToolEvent, ToolRenderDecision } from './types.js';
import { AskResult, FileTreeResult, SlashCommandResult } from '../tui/tool-results.js';

export function createDefaultToolRendererManifest(): ExtensionManifest {
  const completedAskCalls = new Set<string>();
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
        toolName: 'slash:*',
        render: (event) => terminalTranscriptResult(event, new SlashCommandResult(
          event.error ?? event.output
        )),
      },
    ],
  };
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
