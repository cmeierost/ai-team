import type {
  BeforePersistAssistantMessageHookPayload,
  IOrchestratorHookPlugin,
} from '../pipeline.js';
import { emitLog } from '../stream-events.js';
import { stripHandoffDirective } from '../../commands/chat/index.js';

/**
 * Default persist-time assistant message filter.
 *
 * Removes internal routing directives (HANDOFF:/FORWARD_TO:) from text that is
 * written to session history so developers only see user-facing assistant text.
 */
export class StripInternalHandoffDirectivePlugin implements IOrchestratorHookPlugin {
  readonly name = 'strip-internal-handoff-directive';

  onBeforePersistAssistantMessage({ fullResponse, persistedContent, ctx }: BeforePersistAssistantMessageHookPayload): string {
    const source = persistedContent || fullResponse;
    const filtered = stripHandoffDirective(source);
    if (filtered !== source) {
      emitLog(
        ctx.hooks,
        'info',
        '[filter] Stripped internal handoff directive before persisting assistant message.',
      );
    }
    return filtered;
  }
}

export function buildDefaultHookPlugins(): IOrchestratorHookPlugin[] {
  return [new StripInternalHandoffDirectivePlugin()];
}
