import type { ChatMessage } from '@ai-team/core';
import type { ChatOptions, InteractionContext } from '@ai-team/api-contracts';
import { runWorkflowAsync } from '../../workflow/runner.js';
import type { WorkflowDefinition } from '../../workflow/types.js';
import type { ResolveChatSessionCommand } from './resolve-chat-session.command.js';
import type { LoadSessionMessagesCommand } from './load-session-messages.command.js';
import type { EmitSink } from '../../orchestrator/chat-emitter.js';

interface ChatSessionStartupState {
  currentAgentId: string;
  options: Pick<ChatOptions, 'sessionId' | 'createNewSession'>;
  developerName?: string;
  sink?: EmitSink;
  resolveChatSessionCommand: ResolveChatSessionCommand;
  loadSessionMessagesCommand: LoadSessionMessagesCommand;
  sessionId?: string;
  shouldLoadHistory?: boolean;
  reason?: 'startup' | 'back-nav';
  history: ChatMessage[];
}

const chatSessionStartupWorkflow: WorkflowDefinition<ChatSessionStartupState> = {
  id: 'chat-session-startup',
  steps: [
    {
      id: 'resolve-session',
      kind: 'action',
      execute: async (state) => {
        const resolution = await state.resolveChatSessionCommand.execute({
          currentAgentId: state.currentAgentId,
          options: state.options,
          developerName: state.developerName,
        });

        return {
          ...state,
          sessionId: resolution.sessionId,
          shouldLoadHistory: resolution.shouldLoadHistory,
          reason: resolution.reason,
        };
      },
    },
    {
      id: 'load-session-messages',
      kind: 'action',
      skipWhen: (state) => !state.shouldLoadHistory,
      execute: async (state) => {
        const history = await state.loadSessionMessagesCommand.execute({
          sessionId: state.sessionId!,
          reason: state.reason ?? 'startup',
          sink: state.sink,
        });

        return {
          ...state,
          history,
        };
      },
    },
  ],
};

interface ChatSessionStartupDeps {
  resolveChatSessionCommand: ResolveChatSessionCommand;
  loadSessionMessagesCommand: LoadSessionMessagesCommand;
}

interface ChatSessionStartupInput {
  currentAgentId: string;
  options: Pick<ChatOptions, 'sessionId' | 'createNewSession'>;
  developerName?: string;
  sink?: EmitSink;
}

export interface ChatSessionStartupResult {
  sessionId: string;
  history: ChatMessage[];
}

export async function runChatSessionStartupWorkflow(
  input: ChatSessionStartupInput,
  deps: ChatSessionStartupDeps,
  context: InteractionContext
): Promise<ChatSessionStartupResult> {
  const initialState: ChatSessionStartupState = {
    ...input,
    ...deps,
    history: [],
  };

  const result = await runWorkflowAsync(chatSessionStartupWorkflow, initialState, context);
  if (result.aborted) {
    throw new Error('Chat session startup workflow was aborted.');
  }

  if (!result.state.sessionId) {
    throw new Error('Chat session startup workflow did not resolve a session id.');
  }

  return {
    sessionId: result.state.sessionId,
    history: result.state.history,
  };
}
