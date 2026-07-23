import type { ICommandDescriptor } from '@ai-team/core';

export interface SlashInvocation {
  commandToken: string;
  rawArgs: string;
  rawInput: string;
}

export interface ResolvedSlashInvocation extends SlashInvocation {
  /** Canonical dispatcher key, for example `system-help`. */
  commandKey: string;
  /** The public command identity as entered, for example `system help` or `help`. */
  commandToken: string;
  /** The command descriptor selected from the chat registry. */
  descriptor: ICommandDescriptor;
  /** Canonical user-facing invocation inserted by completion. */
  canonicalInvocation: string;
}

function splitLeadingToken(value: string): { token: string; rest: string } | undefined {
  const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(value.trim());
  if (!match?.[1]) return undefined;
  return { token: match[1].toLowerCase(), rest: match[2] ?? '' };
}

export function isDynamicSlashCommand(descriptor: Pick<ICommandDescriptor, 'path'>): boolean {
  return descriptor.path?.[0] === 'dynamic';
}

export function formatSlashInvocation(descriptor: Pick<ICommandDescriptor, 'key' | 'group' | 'path'>): string {
  if (isDynamicSlashCommand(descriptor) || !descriptor.group) return `/${descriptor.key}`;
  return `/${descriptor.group} ${descriptor.key}`;
}

/**
 * Resolves the public slash namespace. Built-ins use `/group key`; dynamic
 * entries and explicitly declared aliases use one token.
 */
export function resolveSlashInvocation(
  message: string,
  descriptors: ICommandDescriptor[]
): ResolvedSlashInvocation | undefined {
  const invocation = parseSlashInvocation(message);
  if (!invocation) return undefined;

  const firstToken = invocation.commandToken;
  const aliasMatch = descriptors.find((descriptor) =>
    (descriptor.aliases ?? []).some((alias) => alias.toLowerCase() === firstToken)
  );
  const dynamicMatch = descriptors.find(
    (descriptor) => isDynamicSlashCommand(descriptor) && descriptor.key.toLowerCase() === firstToken
  );
  const directMatch = aliasMatch ?? dynamicMatch;
  if (directMatch) {
    return {
      ...invocation,
      commandKey: directMatch.group ? `${directMatch.group}-${directMatch.key}` : directMatch.key,
      descriptor: directMatch,
      canonicalInvocation: formatSlashInvocation(directMatch),
    };
  }

  const second = splitLeadingToken(invocation.rawArgs);
  if (!second) return undefined;
  const groupedMatch = descriptors.find(
    (descriptor) =>
      !isDynamicSlashCommand(descriptor) &&
      descriptor.group?.toLowerCase() === firstToken &&
      descriptor.key.toLowerCase() === second.token
  );
  if (!groupedMatch) return undefined;

  return {
    ...invocation,
    commandToken: `${firstToken} ${second.token}`,
    rawArgs: second.rest,
    commandKey: `${groupedMatch.group}-${groupedMatch.key}`,
    descriptor: groupedMatch,
    canonicalInvocation: formatSlashInvocation(groupedMatch),
  };
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
