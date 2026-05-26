export interface ParsedUrlAndOptions {
  url?: string;
  options: Record<string, unknown>;
  error?: string;
}

export function parseUrlAndJsonOptions(args: string): ParsedUrlAndOptions {
  const trimmed = args.trim();
  if (!trimmed) {
    return { options: {}, error: 'missing-url' };
  }

  const firstSpace = trimmed.indexOf(' ');
  const url = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).trim();
  const rawJson = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();

  if (!url) {
    return { options: {}, error: 'missing-url' };
  }

  if (!rawJson) {
    return { url, options: {} };
  }

  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { url, options: {}, error: 'json-object-required' };
    }
    return { url, options: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      url,
      options: {},
      error: `Invalid JSON args: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
