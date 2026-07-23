import type { ICommandDispatcher } from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';
import { resolveSlashInvocation } from '../../command-dispatcher/slash-invocation.js';
import type { PreLlmIntentProvider, ScoredPreLlmIntentCandidate } from './pre-llm-intents.js';

export class SlashIntentProvider implements PreLlmIntentProvider {
  constructor(private readonly commandDispatcher: ICommandDispatcher) {}

  async resolveCandidates(
    message: string,
    _ctx: ExecutionContext
  ): Promise<ScoredPreLlmIntentCandidate[]> {
    const invocation = resolveSlashInvocation(
      message,
      this.commandDispatcher.getCommands({ chat: true })
    );
    if (!invocation) {
      return [];
    }
    return [
      {
        kind: 'command',
        commandKey: invocation.commandKey,
        rawArgs: invocation.rawArgs,
        score: 100,
        reason: 'Slash command detected in chat input.',
        source: 'slash-intent-provider',
      },
    ];
  }
}
