import type { ChatSlashCommand } from './shared-chat-commands.js';
import type { IContextService } from '@ai-team/api-contracts';
import { SessionInfoChatCommand } from './session-info-chat.command.js';
import { NewSessionChatCommand } from './new-session-chat.command.js';
import { HistoryChatCommand } from './history-chat.command.js';
import { BackChatCommand } from './back-chat.command.js';
import { ContextChatCommand } from './context-chat.command.js';
import { InspectChatCommand } from './inspect-chat.command.js';

export interface SessionChatCommandDependencies {
  contextService: Pick<IContextService, 'getContextEstimate'>;
}

function createDefaultSessionChatDependencies(): SessionChatCommandDependencies {
  return {
    contextService: {
      getContextEstimate: async () => {
        throw new Error('contextService is required to evaluate /session context');
      },
    },
  };
}

export function buildSessionChatCommands(
  deps: SessionChatCommandDependencies = createDefaultSessionChatDependencies()
): ChatSlashCommand[] {
  return [
    new SessionInfoChatCommand(deps.contextService),
    new NewSessionChatCommand(),
    new HistoryChatCommand(),
    new BackChatCommand(),
    new ContextChatCommand(),
    new InspectChatCommand(),
  ];
}
