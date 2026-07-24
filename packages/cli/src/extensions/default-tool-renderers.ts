import { sliceByColumn, visibleWidth, type Component } from '@ai-team/tui';
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
          event.error ?? event.commandResponseData ?? event.output
        )),
      },
      {
        toolName: 'fs_read',
        render: (event) => renderReadResult(event),
      },
      {
        toolName: 'fs_write',
        render: (event) => renderWriteResult(event),
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

  const value = event.error ?? event.commandResponseData ?? event.output;
  const record = asRecord(value);
  if (event.phase !== 'result' || typeof record?.['content'] !== 'string') {
    return terminalTranscriptResult(
      event,
      new ToolEvent('fs_read', undefined, value, event.phase, {
        maxInputLines: 4,
        maxOutputLines: 24,
      })
    );
  }
  return terminalTranscriptResult(event, new AnsiLinesResult(formatReadLines(value), 27));
}

function formatReadLines(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [formatTerminalValue(value)];
  const result = value as Record<string, unknown>;
  if (typeof result['content'] !== 'string') return [formatTerminalValue(value)];

  const path = typeof result['path'] === 'string' ? result['path'] : 'file';
  const startLine = typeof result['startLine'] === 'number' ? result['startLine'] : undefined;
  const endLine = typeof result['endLine'] === 'number' ? result['endLine'] : undefined;
  const scope = result['isFullFile'] === true ? 'full-file' : 'partial-slice';
  const range = startLine !== undefined && endLine !== undefined
    ? ` lines ${startLine}-${endLine}`
    : '';
  const contentLines = result['content'].split('\n');
  const numberWidth = String(endLine ?? ((startLine ?? 1) + contentLines.length - 1)).length;
  return [
    `\x1b[1mFile: ${path}\x1b[0m`,
    `\x1b[2mScope: ${scope}${range}\x1b[0m`,
    '',
    ...contentLines.map((line, index) => {
      const lineNumber = (startLine ?? 1) + index;
      return `\x1b[2m${String(lineNumber).padStart(numberWidth, ' ')} │\x1b[0m ${highlightCodeLine(line, path)}`;
    }),
  ];
}

function renderWriteResult(event: NormalizedToolEvent): ToolRenderDecision {
  if (event.phase !== 'result' && event.phase !== 'error' && event.phase !== 'denied') {
    return { handled: false, placements: [] };
  }
  if (event.phase !== 'result') {
    return terminalTranscriptResult(event, new ToolEvent(
      'fs_write',
      undefined,
      event.error ?? event.output,
      event.phase
    ));
  }

  const payload = asRecord(event.commandResponseData);
  const changes = Array.isArray(payload?.['_fileChanges']) ? payload['_fileChanges'] : [];
  const lines = changes.flatMap((change, index) => {
    const record = asRecord(change);
    if (!record) return [];
    const filePath = typeof record['filePath'] === 'string'
      ? record['filePath']
      : (typeof payload?.['path'] === 'string' ? payload['path'] : 'file');
    const oldContent = typeof record['oldContent'] === 'string' ? record['oldContent'] : '';
    const newContent = typeof record['newContent'] === 'string' ? record['newContent'] : '';
    return [
      ...(index > 0 ? [''] : []),
      `\x1b[1mFile: ${filePath}\x1b[0m`,
      ...formatDiffLines(oldContent, newContent, filePath),
    ];
  });

  if (lines.length === 0) {
    return terminalTranscriptResult(event, new ToolEvent(
      'fs_write',
      undefined,
      event.commandResponseData ?? event.output,
      event.phase
    ));
  }
  return terminalTranscriptResult(event, new AnsiLinesResult(lines));
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

class AnsiLinesResult implements Component {
  _parent: import('@ai-team/tui').Container | null = null;

  constructor(private readonly lines: string[], private readonly maxLines = 80) {}

  render(width: number): string[] {
    const visible = this.lines.slice(0, this.maxLines).map((line) =>
      visibleWidth(line) > width ? sliceByColumn(line, 0, Math.max(1, width)) : line
    );
    if (this.lines.length > visible.length) {
      visible.push(`\x1b[2m⋮ ${this.lines.length - visible.length} more lines\x1b[0m`);
    }
    return visible;
  }

  invalidate(): void {}

  remove(): void {
    this._parent?.removeChild(this);
  }
}

function highlightCodeLine(line: string, filePath: string): string {
  const extension = filePath.toLowerCase().match(/(\.[a-z0-9]+)$/)?.[1] ?? '';
  const supported = [
    '.ts', '.tsx', '.js', '.jsx', '.json', '.mjs', '.cjs', '.css', '.scss',
    '.yaml', '.yml', '.md', '.py', '.cs',
  ];
  if (!supported.includes(extension)) return line;

  const tokenPattern =
    /(\/\/.*$|#.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:const|let|var|function|return|class|interface|type|import|from|export|async|await|if|else|for|while|new|extends|implements|public|private|protected|static|readonly|namespace|using|def|self|None)\b|\b(?:true|false|null|undefined|True|False)\b|\b\d+(?:\.\d+)?\b)/g;

  return line.replace(tokenPattern, (token, _match, offset: number, source: string) => {
    if (token.startsWith('//') || token.startsWith('#')) return `\x1b[90m${token}\x1b[0m`;
    if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
      const after = source.slice(offset + token.length);
      return /^\s*:/.test(after)
        ? `\x1b[36m${token}\x1b[0m`
        : `\x1b[32m${token}\x1b[0m`;
    }
    if (/^\d/.test(token)) return `\x1b[33m${token}\x1b[0m`;
    if (/^(?:true|false|null|undefined|True|False)$/.test(token)) {
      return `\x1b[35m${token}\x1b[0m`;
    }
    return `\x1b[36m${token}\x1b[0m`;
  });
}

type DiffDisplayLine = {
  kind: 'context' | 'remove' | 'add' | 'ellipsis';
  oldLine?: number;
  newLine?: number;
  text: string;
};

function formatDiffLines(oldContent: string, newContent: string, filePath: string): string[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) prefix += 1;

  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix += 1;

  const context = 3;
  const rows: DiffDisplayLine[] = [];
  const leadingStart = Math.max(0, prefix - context);
  if (leadingStart > 0) rows.push({ kind: 'ellipsis', text: '⋮' });
  for (let index = leadingStart; index < prefix; index += 1) {
    rows.push({ kind: 'context', oldLine: index + 1, newLine: index + 1, text: oldLines[index] });
  }
  for (let index = prefix; index < oldLines.length - suffix; index += 1) {
    rows.push({ kind: 'remove', oldLine: index + 1, text: oldLines[index] });
  }
  for (let index = prefix; index < newLines.length - suffix; index += 1) {
    rows.push({ kind: 'add', newLine: index + 1, text: newLines[index] });
  }
  const trailingCount = Math.min(context, suffix);
  for (let offset = trailingCount; offset > 0; offset -= 1) {
    const oldIndex = oldLines.length - offset;
    const newIndex = newLines.length - offset;
    rows.push({
      kind: 'context',
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
      text: oldLines[oldIndex],
    });
  }
  if (suffix > context) rows.push({ kind: 'ellipsis', text: '⋮' });

  const numberWidth = String(Math.max(oldLines.length, newLines.length)).length;
  return rows.map((row) => {
    if (row.kind === 'ellipsis') {
      return `\x1b[2m${' '.repeat(numberWidth * 2 + 5)}${row.text}\x1b[0m`;
    }
    const oldNumber = row.oldLine
      ? String(row.oldLine).padStart(numberWidth, ' ')
      : ' '.repeat(numberWidth);
    const newNumber = row.newLine
      ? String(row.newLine).padStart(numberWidth, ' ')
      : ' '.repeat(numberWidth);
    const marker = row.kind === 'remove' ? '-' : row.kind === 'add' ? '+' : ' ';
    const color = row.kind === 'remove'
      ? '\x1b[31m'
      : row.kind === 'add'
        ? '\x1b[32m'
        : '\x1b[37m';
    return `${color}${oldNumber} ${newNumber} ${marker}\x1b[0m ${highlightCodeLine(row.text, filePath)}`;
  });
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
