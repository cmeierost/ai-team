import type { Agent, ChatMessage, ExecutionContext } from '@ai-team/core';
import type { ChatOptions } from '@ai-team/api-contracts';
import type {
  ResolveChatSessionCommand,
  ResolveChatSessionResult,
} from './resolve-chat-session.command.js';
import type { LoadSessionMessagesCommand } from './load-session-messages.command.js';
import type { IntroductionCommand } from './introduction.command.js';

interface ChatSessionStartupDeps {
  resolveChatSessionCommand: ResolveChatSessionCommand;
  loadSessionMessagesCommand: LoadSessionMessagesCommand;
  introductionCommand?: Pick<IntroductionCommand, 'execute'>;
}

interface ChatSessionStartupInput {
  agent: Agent;
  options: Pick<ChatOptions, 'sessionId' | 'createNewSession'> & {
    introduction?: boolean;
    introductionText?: string;
  };
  developerName?: string;
}

export interface ChatSessionStartupResult {
  sessionId: string;
  history: ChatMessage[];
}

export async function runChatSessionStartup(
  input: ChatSessionStartupInput,
  deps: ChatSessionStartupDeps,
  _context: ExecutionContext
): Promise<ChatSessionStartupResult> {
  const resolved = (await deps.resolveChatSessionCommand.execute({
    currentAgentId: input.agent.id,
    options: input.options,
    developerName: input.developerName,
  })) as ResolveChatSessionResult;

  const history = resolved.shouldLoadHistory
    ? ((await deps.loadSessionMessagesCommand.execute({
        sessionId: resolved.sessionId,
        reason: resolved.reason ?? 'startup',
      })) as ChatMessage[])
    : [];

  if (input.options.introduction === true && !resolved.shouldLoadHistory) {
    await deps.introductionCommand?.execute({
      agent: input.agent,
      history,
      developerName: input.developerName,
      sessionId: resolved.sessionId,
      text: input.options.introductionText,
    });
  }

  return {
    sessionId: resolved.sessionId,
    history,
  };
}
