import type { InitOptions } from '@ai-team/api-contracts';
import type { ITerminal } from '@ai-team/core';
import type { ICliCommandClient } from '../cli-command-client.js';
import type { InquirerQuestionService } from './question-responders.js';
import { renderChat } from './chat.js';

interface InitTuiDependencies {
  terminal?: ITerminal;
  questionService?: InquirerQuestionService;
}

/**
 * Run initialization in the shared chat TUI.
 *
 * The onboarding workflow selects and creates the CEO before starting its
 * business-definition phase. Keeping the complete command stream in the chat
 * renderer lets that session switch become visible immediately, without
 * tearing down one terminal UI and constructing another.
 */
export async function renderInit(
  client: ICliCommandClient,
  options: InitOptions,
  dependencies: InitTuiDependencies = {}
): Promise<void> {
  await renderChat(
    client,
    undefined,
    { oneShot: true },
    false,
    undefined,
    'init',
    { options },
    dependencies
  );
}
