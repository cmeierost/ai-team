import type { WebSocket } from 'ws';
import type {
  StreamEvent,
} from '@ai-team/api-contracts';
import type { IAgentManager, IdeAdapter, IServiceContainer } from '@ai-team/core';
import { createIdeAdapter } from '@ai-team/infrastructure';
import { SessionManager, WsQuestionService } from '@ai-team/service';
import { TOKENS } from '@ai-team/container';

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
  /** Message type: 'message' = chat message, 'cancel' = abort operation, 'answer' = respond to question, 'interrupt' = hard interrupt, 'steer' = drift in message, 'summarize' = LLM-backed note summarize */
  type: 'message' | 'cancel' | 'answer' | 'interrupt' | 'steer' | 'summarize';
  /** Chat message content (required for 'message', 'steer' type) */
  content?: string;
  /** Additional options for the chat interaction (optional for 'message' type) */
  options?: any;
  /** Answer to a question (required for 'answer' type) */
  answer?: {
    /** Question ID from the QuestionEvent */
    questionId: string;
    /** Answer value (string/bool/number/array/object depending on question type) */
    value: string | boolean | number | string[] | Record<string, string>;
  };
  /** Summarize operation (required for 'summarize' type): 'compact' or 'crawl' */
  operation?: 'compact' | 'crawl';
  /** Note ID to summarize (required for 'summarize' type) */
  noteId?: string;
  /** Website URL to crawl (required for operation='crawl') */
  websiteUrl?: string;
  /** Max pages to crawl (optional for operation='crawl') */
  maxPages?: number;
  /** Max words for summary (optional for 'summarize' type) */
  maxWords?: number;
  /** Focus instruction for summarization (optional for 'summarize' type) */
  focusInstruction?: string;
  /** Generate and apply a note title from summarized content */
  generateTitle?: boolean;
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
  /** Event type discriminator for client parsing */
  type: 'ready' | 'ack' | 'cancelled' | 'question' | 'mediator' | 'error';
  /** Event payload (shape depends on event type) */
  data?: unknown;
}

type ChatStreamEvent = StreamEvent<'chat'>;

export interface ChatWebSocketSetupOptions {
  agentManager?: IAgentManager;
  workspaceRoot?: string;
  llmService?: { ensureInitialized(): Promise<void> };
}

export async function setupChatWebSocket(
  ws: WebSocket,
  agentQuery: string,
  container: IServiceContainer,
  sessionManager: SessionManager,
  sessionId: string | null,
  options: ChatWebSocketSetupOptions = {}
): Promise<void> {
  const { agentManager, workspaceRoot, llmService } = options;
  // Resolve agent query to exact ID
  let agentId = agentQuery;
  if (agentManager) {
    try {
      const resolved = await agentManager.resolveAgentForOperationAsync(
        agentQuery,
        'WebSocket chat'
      );
      agentId = resolved.id;
    } catch (error) {
      // Send error and close connection
      ws.send(
        JSON.stringify({
          type: 'error',
          data: { error: error instanceof Error ? error.message : 'Failed to resolve agent' },
        })
      );
      ws.close();
      return;
    }
  }

  // Connect to VS Code plugin if it is running for this workspace (fire-and-forget init)
  let ideAdapter: IdeAdapter | null = null;
  if (workspaceRoot) {
    createIdeAdapter(workspaceRoot, 'web')
      .then((adapter) => {
        ideAdapter = adapter;
      })
      .catch(() => {
        /* no IDE connected — silent */
      });
  }

  let currentAbortController: AbortController | null = null;

  // Set up WebSocket-backed question service for this connection.
  const questionService = new WsQuestionService();
  questionService.setup((data) => {
    ws.send(JSON.stringify({ type: 'question', data }));
  });
  container.registerInstance(TOKENS.QuestionService, questionService);
  const interactionService = container.resolve(TOKENS.InteractionService);

  ws.on('message', async (data: Buffer) => {
    try {
      const message: ChatWebSocketMessage = JSON.parse(data.toString());

      if (message.type === 'answer') {
        // Route answer back to the pending question promise.
        if (message.answer) {
          questionService.receiveAnswer(message.answer.questionId, message.answer.value);
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
        questionService.cancelAll(new Error('Cancelled'));
        ws.send(JSON.stringify({ type: 'cancelled' }));
        return;
      }

      if (message.type === 'message') {
        if (!message.content) {
          ws.send(
            JSON.stringify({ type: 'error', data: { error: 'Message content is required' } })
          );
          return;
        }

        // Acknowledge receipt immediately so the client can show activity
        ws.send(JSON.stringify({ type: 'ack' }));

        // Cancel any existing operation
        if (currentAbortController) {
          currentAbortController.abort();
        }

        // Cancel any pending questions
        questionService.cancelAll(new Error('New message started'));

        // Create new abort controller for this operation
        currentAbortController = new AbortController();

        try {
          // Message persistence is handled by the service layer (chatCommand/sendMessage)
          // — no need to save user or assistant messages here.

          // Stream chat response with question handlers
          const stream = interactionService.stream(
            {
              command: 'chat',
              payload: {
                employeeId: agentId,
                options: {
                  message: message.content,
                  sessionId: sessionId ?? undefined,
                  ...message.options,
                  oneShot: message.options?.oneShot ?? true,
                },
              },
            },
            {
              signal: currentAbortController.signal,
            }
          );

          for await (const event of stream) {
            // Check if cancelled
            if (currentAbortController.signal.aborted) {
              break;
            }

            // Internal debug events — not useful for web clients
            if (event.kind === 'log') {
              continue;
            }

            // Forward code-edit proposals to VS Code plugin
            if (event.kind === 'code_edit_proposal' && ideAdapter) {
              const e = event;
              ideAdapter
                .notifyCodeEditProposal({
                  proposalId: e.proposalId ?? '',
                  agentName: e.agentName ?? agentId,
                  description: e.description ?? '',
                  files: (e.files ?? []).map((f) => ({
                    filePath: f.filePath,
                    oldContent: f.oldContent ?? '',
                    newContent: f.newContent ?? '',
                    additions: f.additions ?? 0,
                    deletions: f.deletions ?? 0,
                  })),
                })
                .catch(() => {
                  /* best-effort */
                });
            }

            // Send typed mediator event envelope to client
            const wsEvent: ChatWebSocketEvent = {
              type: 'mediator',
              data: event,
            };
            ws.send(JSON.stringify(wsEvent));
          }
        } catch (error: any) {
          // Check if it was an abort
          if (error.name === 'AbortError' || currentAbortController?.signal.aborted) {
            ws.send(JSON.stringify({ type: 'cancelled' }));
          } else {
            ws.send(JSON.stringify({ type: 'error', data: { error: error.message } }));
          }
        } finally {
          currentAbortController = null;
        }
      }

      if (message.type === 'summarize') {
        if (!sessionId) {
          ws.send(
            JSON.stringify({
              type: 'error',
              data: { error: 'sessionId is required for summarize' },
            })
          );
          return;
        }
        if (!message.noteId) {
          ws.send(
            JSON.stringify({ type: 'error', data: { error: 'noteId is required for summarize' } })
          );
          return;
        }
        if (!llmService) {
          ws.send(JSON.stringify({ type: 'error', data: { error: 'LLM service not available' } }));
          return;
        }

        ws.send(JSON.stringify({ type: 'ack' }));

        if (currentAbortController) {
          currentAbortController.abort();
        }
        questionService.cancelAll(new Error('New summarize started'));
        currentAbortController = new AbortController();

        try {
          const send = (event: ChatStreamEvent) => {
            if (!currentAbortController?.signal.aborted) {
              ws.send(JSON.stringify({ type: 'mediator', data: event }));
            }
          };

          await llmService.ensureInitialized();

          if (message.operation === 'crawl') {
            if (!message.websiteUrl) {
              ws.send(
                JSON.stringify({
                  type: 'error',
                  data: { error: 'websiteUrl is required for crawl operation' },
                })
              );
              return;
            }
            send({ kind: 'status', status: 'Crawling website...' } as any);
            const note = await sessionManager.summarizeWebsiteNoteAsync(
              message.noteId,
              llmService,
              message.websiteUrl,
              message.maxPages,
              message.maxWords,
              message.focusInstruction,
              message.generateTitle === true
            );
            send({ kind: 'status', status: 'Done' } as any);
            send({ kind: 'done', result: note } as any);
          } else {
            send({ kind: 'status', status: 'Summarizing note...' } as any);
            const note = await sessionManager.compactNoteAsync(
              message.noteId,
              llmService,
              message.maxWords,
              message.focusInstruction,
              message.generateTitle === true
            );
            send({ kind: 'status', status: 'Done' } as any);
            send({ kind: 'done', result: note } as any);
          }
        } catch (error: any) {
          if (error.name === 'AbortError' || currentAbortController?.signal.aborted) {
            ws.send(JSON.stringify({ type: 'cancelled' }));
          } else {
            ws.send(JSON.stringify({ type: 'error', data: { error: error.message } }));
          }
        } finally {
          currentAbortController = null;
        }
        return;
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
    questionService.cancelAll(new Error('Connection closed'));
    ideAdapter?.dispose();
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    if (currentAbortController) {
      currentAbortController.abort();
      currentAbortController = null;
    }
    // Reject all pending questions
    questionService.cancelAll(new Error('Connection error'));
  });

  // Send ready event
  ws.send(JSON.stringify({ type: 'ready' }));
}
