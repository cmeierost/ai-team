import { randomUUID } from 'node:crypto';

export interface ParsedTextToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export class LlmTextToolParser {
  parseBracketToolCalls(assistantText: string, knownToolNames: Set<string>): ParsedTextToolCall[] {
    const calls: ParsedTextToolCall[] = [];
    const re = /\[tool:([a-zA-Z0-9_]+)\]\s*([\s\S]*?)(?=\n\s*\[tool:[a-zA-Z0-9_]+\]|$)/g;

    for (const match of assistantText.matchAll(re)) {
      const toolName = (match[1] ?? '').trim();
      if (!toolName || !knownToolNames.has(toolName)) {
        continue;
      }

      const rawPayload = (match[2] ?? '').trim();
      const normalizedPayload = rawPayload
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      let args: unknown = {};
      if (normalizedPayload) {
        try {
          args = JSON.parse(normalizedPayload);
        } catch {
          continue;
        }
      }

      calls.push({
        toolCallId: randomUUID(),
        toolName,
        args,
      });
    }

    return calls;
  }

  parseTextToolCalls(assistantText: string, knownToolNames: Set<string>): ParsedTextToolCall[] {
    const bracketCalls = this.parseBracketToolCalls(assistantText, knownToolNames);
    if (bracketCalls.length > 0) {
      return bracketCalls;
    }

    const jsonFallback = this.parseJsonObjectToolCall(assistantText, knownToolNames);
    return jsonFallback ? [jsonFallback] : [];
  }

  private parseJsonObjectToolCall(
    assistantText: string,
    knownToolNames: Set<string>
  ): ParsedTextToolCall | undefined {
    const normalized = assistantText.trim();
    if (!normalized) {
      return undefined;
    }

    const candidates = [normalized];
    const fenced = normalized.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced?.[1]) {
      candidates.push(fenced[1].trim());
    }

    for (const candidate of candidates) {
      const parsed = this.tryParseJson(candidate);
      if (parsed === undefined) {
        continue;
      }

      const call = this.jsonValueToToolCall(parsed, knownToolNames);
      if (call) {
        return call;
      }
    }

    return undefined;
  }

  private tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }

  private jsonValueToToolCall(
    payload: unknown,
    knownToolNames: Set<string>
  ): ParsedTextToolCall | undefined {
    if (Array.isArray(payload)) {
      for (const item of payload) {
        const nested = this.jsonValueToToolCall(item, knownToolNames);
        if (nested) {
          return nested;
        }
      }
      return undefined;
    }

    if (!payload || typeof payload !== 'object') {
      return undefined;
    }

    const record = payload as Record<string, unknown>;
    const functionRecord =
      record.function && typeof record.function === 'object'
        ? (record.function as Record<string, unknown>)
        : undefined;

    const toolNameCandidate =
      this.readString(record.name) ||
      this.readString(record.toolName) ||
      this.readString(record.tool) ||
      this.readString(functionRecord?.name);

    if (!toolNameCandidate || !knownToolNames.has(toolNameCandidate)) {
      return undefined;
    }

    const rawArgs =
      record.arguments ??
      record.args ??
      record.parameters ??
      functionRecord?.arguments ??
      functionRecord?.args ??
      functionRecord?.parameters ??
      {};

    const args = this.normalizeToolArgs(rawArgs);

    return {
      toolCallId: randomUUID(),
      toolName: toolNameCandidate,
      args,
    };
  }

  private normalizeToolArgs(rawArgs: unknown): Record<string, unknown> {
    let parsed = rawArgs;

    if (typeof parsed === 'string') {
      const parsedJson = this.tryParseJson(parsed.trim());
      parsed = parsedJson === undefined ? {} : parsedJson;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed as Record<string, unknown>;
  }

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
}
