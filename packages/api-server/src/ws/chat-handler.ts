import type { WebSocket } from 'ws';
import type { AiTeamClient } from '@ai-team/api-client';
import type { AgentManager } from '@ai-team/core';
import type { QuestionInputRequest, QuestionConfirmRequest, QuestionSelectRequest, QuestionPasswordRequest, QuestionChecklistRequest } from '@ai-team/service';
import { resolveAgentForOperation, SessionManager } from '@ai-team/service';

/**
 * Messages sent from client to server over WebSocket.
 * 
 * @example Send a chat message
 * ```json
 * {
 *   "type": "message",
 *   "content": "What tasks are assigned to me?",
 *   "options": {}
 * }
 * ```
 * 
 * @example Cancel an ongoing operation
 * ```json
 * {
 *   "type": "cancel"
 * }
 * ```
 * 
 * @example Answer an agent question
 * ```json
 * {
 *   "type": "answer",
 *   "answer": {
 *     "questionId": "q1",
 *     "value": "my-branch-name"
 *   }
 * }
 * ```
 */
export interface ChatWebSocketMessage {
  /** Message type: 'message' = chat message, 'cancel' = abort operation, 'answer' = respond to question */
  type: 'message' | 'cancel' | 'answer';
  /** Chat message content (required for 'message' type) */
  content?: string;
  /** Additional options for the chat interaction (optional for 'message' type) */
  options?: any;
  /** Answer to a question (required for 'answer' type) */
  answer?: {
    /** Question ID from the QuestionEvent */
    questionId: string;
    /** Answer value (string for input/select/password, boolean for confirm, string[] for checklist) */
    value: string | boolean | string[];
  };
}

/**
 * Events sent from server to client over WebSocket.
 * 
 * @example Streaming token
 * ```json
 * {
 *   "type": "token",
 *   "data": { "token": "Hello" }
 * }
 * ```
 * 
 * @example Status update
 * ```json
 * {
 *   "type": "status",
 *   "data": { "status": "ready" }
 * }
 * ```
 * 
 * @example Agent question
 * ```json
 * {
 *   "type": "question",
 *   "data": {
 *     "questionId": "q1",
 *     "kind": "input",
 *     "message": "What branch name?"
 *   }
 * }
 * ```
 * 
 * @example Error
 * ```json
 * {
 *   "type": "error",
 *   "data": { "error": "Agent not found" }
 * }
 * ```
 * 
 * @example Completion
 * ```json
 * {
 *   "type": "done"
 * }
 * ```
 */
export interface ChatWebSocketEvent {
  /** Event type: 'token' = streaming text, 'status' = status update, 'tool' = tool execution, 'question' = agent question, 'error' = error occurred, 'done' = response complete */
  type: 'token' | 'status' | 'tool' | 'question' | 'error' | 'done';
  /** Event payload (structure varies by event type) */
  data?: any;
}

export function setupChatWebSocket(
  ws: WebSocket,
  agentQuery: string,
  client: AiTeamClient,
  sessionManager: SessionManager,
  sessionId: string | null,
  agentManager?: AgentManager
): void {
  // Resolve agent query to exact ID
  let agentId = agentQuery;
  if (agentManager) {
    try {
      const resolved = resolveAgentForOperation(agentManager, agentQuery, 'WebSocket chat');
      agentId = resolved.id;
    } catch (error) {
      // Send error and close connection
      ws.send(JSON.stringify({
        type: 'error',
        data: { error: error instanceof Error ? error.message : 'Failed to resolve agent' },
      }));
      ws.close();
      return;
    }
  }

  let currentAbortController: AbortController | null = null;
  let questionCounter = 0;
  const pendingQuestions = new Map<string, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }>();

  // Helper to wait for answer from client
  const askQuestion = async (questionId: string, questionData: any): Promise<any> => {
    return new Promise((resolve, reject) => {
      pendingQuestions.set(questionId, { resolve, reject });
      
      // Send question to client
      ws.send(JSON.stringify({
        type: 'question',
        data: {
          questionId,
          ...questionData,
        },
      }));

        // No timeout: questions can remain pending until answered or connection closes.
    });
  };

  ws.on('message', async (data: Buffer) => {
    try {
      const message: ChatWebSocketMessage = JSON.parse(data.toString());

      if (message.type === 'answer') {
        // Handle answer to a pending question
        if (message.answer) {
          const { questionId, value } = message.answer;
          const pending = pendingQuestions.get(questionId);
          if (pending) {
            pendingQuestions.delete(questionId);
            pending.resolve(value);
          }
        }
        return;
      }

      if (message.type === 'cancel') {
        // Cancel current operation
        if (currentAbortController) {
          currentAbortController.abort();
          currentAbortController = null;
        }
        // Cancel all pending questions
        pendingQuestions.forEach(({ reject }) => reject(new Error('Cancelled')));
        pendingQuestions.clear();
        ws.send(JSON.stringify({ type: 'status', data: { status: 'cancelled' } }));
        return;
      }

      if (message.type === 'message') {
        if (!message.content) {
          ws.send(JSON.stringify({ type: 'error', data: { error: 'Message content is required' } }));
          return;
        }

        // Cancel any existing operation
        if (currentAbortController) {
          currentAbortController.abort();
        }

        // Cancel any pending questions
        pendingQuestions.forEach(({ reject }) => reject(new Error('New message started')));
        pendingQuestions.clear();

        // Create new abort controller for this operation
        currentAbortController = new AbortController();

        try {
          // Message persistence is handled by the service layer (chatCommand/sendMessage)
          // — no need to save user or assistant messages here.

          // Stream chat response with question handlers
          const stream = client.stream(
            {
              command: 'chat',
              payload: {
                employeeId: agentId,
                options: {
                  message: message.content,
                  sessionId: sessionId ?? undefined,
                  ...message.options,
                },
              },
            },
            {
              signal: currentAbortController.signal,
              questionInput: async (request: QuestionInputRequest) => {
                const questionId = `q${++questionCounter}`;
                return askQuestion(questionId, { kind: 'input', ...request });
              },
              questionConfirm: async (request: QuestionConfirmRequest) => {
                const questionId = `q${++questionCounter}`;
                return askQuestion(questionId, { kind: 'confirm', ...request });
              },
              questionSelect: async (request: QuestionSelectRequest) => {
                const questionId = `q${++questionCounter}`;
                return askQuestion(questionId, { kind: 'select', ...request });
              },
              questionPassword: async (request: QuestionPasswordRequest) => {
                const questionId = `q${++questionCounter}`;
                return askQuestion(questionId, { kind: 'password', ...request });
              },
              questionChecklist: async (request: QuestionChecklistRequest) => {
                const questionId = `q${++questionCounter}`;
                return askQuestion(questionId, { kind: 'checklist', ...request });
              },
            }
          );

          for await (const event of stream) {
            // Check if cancelled
            if (currentAbortController.signal.aborted) {
              break;
            }

            // Send event to client
            const wsEvent: ChatWebSocketEvent = {
              type: event.kind as any,
              data: event,
            };
            ws.send(JSON.stringify(wsEvent));
          }

          // Send done event
          if (!currentAbortController.signal.aborted) {
            ws.send(JSON.stringify({ type: 'done' }));
          }
        } catch (error: any) {
          // Check if it was an abort
          if (error.name === 'AbortError' || currentAbortController?.signal.aborted) {
            ws.send(JSON.stringify({ type: 'status', data: { status: 'cancelled' } }));
          } else {
            ws.send(JSON.stringify({ type: 'error', data: { error: error.message } }));
          }
          // Always send done event to signal completion, even after errors
          ws.send(JSON.stringify({ type: 'done' }));
        } finally {
          currentAbortController = null;
        }
      }
    } catch (error: any) {
      ws.send(JSON.stringify({ type: 'error', data: { error: error.message } }));
    }
  });

  ws.on('close', () => {
    // Clean up on disconnect
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    // Reject all pending questions
    pendingQuestions.forEach(({ reject }) => reject(new Error('Connection closed')));
    pendingQuestions.clear();
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    // Reject all pending questions
    pendingQuestions.forEach(({ reject }) => reject(new Error('Connection error')));
    pendingQuestions.clear();
  });

  // Send ready event
  ws.send(JSON.stringify({ type: 'status', data: { status: 'ready' } }));
}
