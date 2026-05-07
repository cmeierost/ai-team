import type { ChatSlashCommand } from './shared-chat-commands.js';
import { HttpCrawlChatCommand, HttpFetchChatCommand } from './http-tools-chat.command.js';
import { OverviewChatCommand } from './overview-chat.command.js';
import { RunShellChatCommand } from './run-shell-chat.command.js';
import { ToolCallChatCommand } from './tool-call-chat.command.js';

export function buildUtilityChatCommands(): ChatSlashCommand[] {
  return [
    new OverviewChatCommand(),
    new RunShellChatCommand(),
    new ToolCallChatCommand(),
    new HttpFetchChatCommand(),
    new HttpCrawlChatCommand(),
  ];
}
