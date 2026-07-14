import type { ICommandDispatcher } from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';
import { deriveRegistryKey } from '../../command-dispatcher/command-registry.js';
import type { PreLlmIntentProvider, ScoredPreLlmIntentCandidate } from './pre-llm-intents.js';

export class SlashIntentProvider implements PreLlmIntentProvider {
  constructor(private readonly commandDispatcher: ICommandDispatcher) {}

  async resolveCandidates(
    message: string,
    _ctx: ExecutionContext
  ): Promise<ScoredPreLlmIntentCandidate[]> {
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) {
      return [];
    }

    const [rawKey, ...rest] = trimmed.slice(1).split(/\s+/);
    const key = (rawKey ?? '').toLowerCase();
    if (!key) {
      return [];
    }

    const rawArgs = rest.join(' ');

    const direct = this.commandDispatcher.getCommand(key);
    const matched = this.commandDispatcher
      .getCommands({ chat: true })
      .find(
        (descriptor) =>
          descriptor.key.toLowerCase() === key ||
          (descriptor.aliases ?? []).some((alias) => alias.toLowerCase() === key)
      );

    const resolvedKey = direct
      ? key
      : matched
        ? deriveRegistryKey(matched.group, matched.key)
        : key;

    return [
      {
        kind: 'command',
        commandKey: resolvedKey,
        rawArgs,
        score: 100,
        reason: 'Slash command detected in chat input.',
        source: 'slash-intent-provider',
      },
    ];
  }
}
