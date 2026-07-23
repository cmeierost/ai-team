import type { ICommandDispatcher } from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';
import { deriveRegistryKey } from '../../command-dispatcher/command-registry.js';
import { parseSlashInvocation } from '../../command-dispatcher/slash-invocation.js';
import type { PreLlmIntentProvider, ScoredPreLlmIntentCandidate } from './pre-llm-intents.js';

export class SlashIntentProvider implements PreLlmIntentProvider {
  constructor(private readonly commandDispatcher: ICommandDispatcher) {}

  async resolveCandidates(
    message: string,
    _ctx: ExecutionContext
  ): Promise<ScoredPreLlmIntentCandidate[]> {
    const invocation = parseSlashInvocation(message);
    if (!invocation) {
      return [];
    }
    const key = invocation.commandToken;

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
        rawArgs: invocation.rawArgs,
        score: 100,
        reason: 'Slash command detected in chat input.',
        source: 'slash-intent-provider',
      },
    ];
  }
}
