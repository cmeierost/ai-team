import type { WebSocket } from 'ws';
import type { AiTeamClient } from '@ai-team/api-client';
import type { QuestionInputRequest, QuestionConfirmRequest, QuestionSelectRequest, QuestionPasswordRequest, QuestionChecklistRequest } from '@ai-team/service';

export interface ChatWebSocketMessage {
  type: 'message' | 'cancel' | 'answer';
  content?: string;
  options?: any;
  answer?: {
    questionId: string;
    value: string | boolean | string[];
  };
}

export interface ChatWebSocketEvent {
  type: 'token' | 'status' | 'tool' | 'question' | 'error' | 'done';
  data?: any;
}

export function setupChatWebSocket(ws: WebSocket, agentId: string, client: AiTeamClient): void {
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

      // Set timeout (30 seconds)
      setTimeout(() => {
        if (pendingQuestions.has(questionId)) {
          pendingQuestions.delete(questionId);
          reject(new Error('Question timeout'));
        }
      }, 30000);
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
          // Stream chat response with question handlers
          const stream = client.stream(
            {
              command: 'chat',
              payload: {
                employeeId: agentId,
                options: {
                  message: message.content,
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
