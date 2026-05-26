import { z } from 'zod';
import type { ChatMessage, ExecutionContext } from '@ai-team/core';
import type { ChatOptions } from '@ai-team/api-contracts';
import type { IWorkflowRunnerFactory } from '../../workflow/runner.js';
import type { WorkflowDefinition } from '../../workflow/types.js';
import type {
  ResolveChatSessionCommand,
  ResolveChatSessionResult,
} from './resolve-chat-session.command.js';
import type { LoadSessionMessagesCommand } from './load-session-messages.command.js';

interface ChatSessionStartupState {
  currentAgentId: string;
  options: Pick<ChatOptions, 'sessionId' | 'createNewSession'>;
  developerName?: string;
  sessionId?: string;
  shouldLoadHistory?: boolean;
  reason?: 'startup' | 'back-nav';
  history: ChatMessage[];
}

const chatSessionStartupWorkflow: WorkflowDefinition<ChatSessionStartupState> = {
  id: 'chat-session-startup',
  description: 'Resolve or create a chat session and load its message history.',
  availableIn: {},
  group: 'chat',
  parameters: z.object({
    currentAgentId: z.string(),
    options: z.object({
      sessionId: z.string().optional(),
      createNewSession: z.boolean().optional(),
    }),
    developerName: z.string().optional(),
  }),
  prepare: (params) => ({
    ...(params as ChatSessionStartupInput),
    history: [],
  }),
  toResult: (state) => ({
    sessionId: state.sessionId!,
    history: state.history,
  }),
  steps: [
    {
      id: 'resolve-session',
      command: 'resolve-chat-session',
      params: (state) => ({
        currentAgentId: state.currentAgentId,
        options: state.options,
        developerName: state.developerName,
      }),
      applyResult: (state, raw) => {
        const r = raw as ResolveChatSessionResult;
        return {
          ...state,
          sessionId: r.sessionId,
          shouldLoadHistory: r.shouldLoadHistory,
          reason: r.reason,
        };
      },
    },
    {
      id: 'load-session-messages',
      command: 'load-session-messages',
      skipWhen: (state) => !state.shouldLoadHistory,
      params: (state) => ({
        sessionId: state.sessionId!,
        reason: state.reason ?? 'startup',
      }),
      applyResult: (state, raw) => ({
        ...state,
        history: raw as ChatMessage[],
      }),
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
}

export interface ChatSessionStartupResult {
  sessionId: string;
  history: ChatMessage[];
}

export async function runChatSessionStartupWorkflow(
  input: ChatSessionStartupInput,
  deps: ChatSessionStartupDeps,
  context: ExecutionContext,
  runnerFactory: IWorkflowRunnerFactory
): Promise<ChatSessionStartupResult> {
  const result = await runnerFactory
    .create()
    .run(chatSessionStartupWorkflow, chatSessionStartupWorkflow.prepare!(input), {
      executionContext: context,
      commands: {
        'resolve-chat-session': deps.resolveChatSessionCommand,
        'load-session-messages': deps.loadSessionMessagesCommand,
      },
    });

  if (result.aborted) {
    throw new Error('Chat session startup workflow was aborted.');
  }

  if (!result.state.sessionId) {
    throw new Error('Chat session startup workflow did not resolve a session id.');
  }

  return chatSessionStartupWorkflow.toResult!(result.state) as ChatSessionStartupResult;
}
