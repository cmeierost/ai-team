export interface SlashInvocation {
  commandToken: string;
  rawArgs: string;
  rawInput: string;
}

/**
 * Extracts a slash-command token while preserving the argument tail verbatim.
 * Argument parsing and validation are owned by CommandDispatcher.
 */
export function parseSlashInvocation(message: string): SlashInvocation | null {
  const rawInput = message.trim();
  if (!rawInput.startsWith('/')) {
    return null;
  }

  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(rawInput);
  const commandToken = (match?.[1] ?? '').toLowerCase();
  if (!commandToken) {
    return null;
  }

  return {
    commandToken,
    rawArgs: match?.[2] ?? '',
    rawInput,
  };
}
