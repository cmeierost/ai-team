import type { IToolSerializationService } from '@ai-team/core';

export class ToolSerializationService implements IToolSerializationService {
  formatArgs(args: unknown): string {
    if (args == null) return '';
    if (typeof args === 'string') return args;
    if (typeof args === 'number' || typeof args === 'boolean' || typeof args === 'bigint') {
      return `${args}`;
    }
    if (typeof args === 'symbol') {
      return args.description ? `Symbol(${args.description})` : 'Symbol()';
    }
    if (typeof args === 'function') return '[function]';
    try {
      const s = JSON.stringify(args);
      return s.length > 120 ? s.slice(0, 120) + '…' : s;
    } catch {
      return '[unparseable]';
    }
  }

  formatToolResultPreview(outputText: string): string {
    const trimmed = outputText.trim();
    if (!trimmed) {
      return 'Completed';
    }

    // Preserve complete JSON payloads in tool events so downstream consumers
    // receive structurally intact data rather than clipped previews.
    if (this.isLikelyJsonDocument(trimmed)) {
      return trimmed;
    }

    const collapsed = outputText.replaceAll(/\s+/g, ' ').trim();

    const maxLen = 220;
    if (collapsed.length <= maxLen) {
      return collapsed;
    }

    return `${collapsed.slice(0, maxLen - 1)}…`;
  }

  isLikelyJsonDocument(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (
      !(
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      )
    ) {
      return false;
    }

    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }

  serialise(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '[unserializable]';
    }
  }

  serializeForStorage(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '[unserializable]';
    }
  }
}
