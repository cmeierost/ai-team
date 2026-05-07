import type { ChatSlashCommand } from './shared-chat-commands.js';
import { TeamListChatCommand } from './team-list-chat.command.js';
import { ChatSwitchChatCommand } from './chat-switch-chat.command.js';
import { PortfolioChatCommand } from './portfolio-chat.command.js';
import { InfoChatCommand } from './info-chat.command.js';

export function buildTeamChatCommands(): ChatSlashCommand[] {
  return [
    new TeamListChatCommand(),
    new ChatSwitchChatCommand(),
    new PortfolioChatCommand(),
    new InfoChatCommand(),
  ];
}
