import type { ChatSlashCommand } from './shared-chat-commands.js';
import { HireChatCommand } from './hire-chat.command.js';
import { FireChatCommand } from './fire-chat.command.js';
import { CreateChatCommand } from './create-chat.command.js';
import { InitChatCommand } from './init-chat.command.js';
import { HhRefreshChatCommand } from './hh-refresh-chat.command.js';
import { TestConnectionChatCommand } from './test-connection-chat.command.js';
import { WorkflowChatCommand } from './workflow-tools-chat.command.js';

export function buildWorkflowChatCommands(): ChatSlashCommand[] {
  return [
    new HireChatCommand(),
    new FireChatCommand(),
    new CreateChatCommand(),
    new InitChatCommand(),
    new WorkflowChatCommand(),
    new HhRefreshChatCommand(),
    new TestConnectionChatCommand(),
  ];
}
