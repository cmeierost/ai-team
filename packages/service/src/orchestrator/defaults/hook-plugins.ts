import type {
  BeforePersistAssistantMessageHookPayload,
  IOrchestratorHookPlugin,
} from '../pipeline.js';
import { ChatCommand } from '../../commands/chat/chat.command.js';

/**
 * Default persist-time assistant message filter.
 *
 * Removes internal routing directives (HANDOFF:/FORWARD_TO:) from text that is
 * written to session history so developers only see user-facing assistant text.
 */
export class StripInternalHandoffDirectivePlugin implements IOrchestratorHookPlugin {
  readonly name = 'strip-internal-handoff-directive';

  onBeforePersistAssistantMessage({
    fullResponse,
    persistedContent,
  }: BeforePersistAssistantMessageHookPayload): string {
    const source = persistedContent || fullResponse;
    const filtered = ChatCommand.stripHandoffDirective(source);
    return filtered;
  }
}

export function buildDefaultHookPlugins(): IOrchestratorHookPlugin[] {
  return [new StripInternalHandoffDirectivePlugin()];
}
