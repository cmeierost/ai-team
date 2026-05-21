import type {
  QuestionInputRequest,
  QuestionConfirmRequest,
  QuestionSelectRequest,
  QuestionPasswordRequest,
  QuestionChecklistRequest,
} from '@ai-team/api-contracts';
import type { IInteractionService } from './question-service.js';

type PendingAnswer = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type SendFn = (data: Record<string, unknown>) => void;

/**
 * WebSocket-backed question service.
 *
 * Emits question events over a WebSocket and suspends until the client answers.
 * Call `setup(send)` after the WebSocket connection is established, then route
 * incoming answer messages back via `receiveAnswer(questionId, value)`.
 * Call `cancelAll(error)` when the connection closes or the operation is aborted.
 */
export class WsQuestionService implements IInteractionService {
  private readonly pending = new Map<string, PendingAnswer>();
  private counter = 0;
  private send: SendFn | null = null;

  setup(send: SendFn): void {
    this.send = send;
  }

  receiveAnswer(questionId: string, value: unknown): boolean {
    const entry = this.pending.get(questionId);
    if (!entry) return false;
    this.pending.delete(questionId);
    entry.resolve(value);
    return true;
  }

  cancelAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  private ask<T>(kind: string, request: object): Promise<T> {
    if (!this.send) {
      throw new Error(
        'WsQuestionService: no active WebSocket connection. ' +
          'Questions require a live WebSocket chat session.'
      );
    }
    const questionId = `q${++this.counter}`;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(questionId, { resolve: resolve as (v: unknown) => void, reject });
      this.send!({ questionId, kind, ...(request as Record<string, unknown>) });
    });
  }

  input(request: QuestionInputRequest): Promise<string> {
    return this.ask<string>('input', request);
  }

  confirm(request: QuestionConfirmRequest): Promise<boolean> {
    return this.ask<boolean>('confirm', request);
  }

  select(request: QuestionSelectRequest): Promise<string> {
    return this.ask<string>('select', request);
  }

  password(request: QuestionPasswordRequest): Promise<string> {
    return this.ask<string>('password', request);
  }

  checklist(request: QuestionChecklistRequest): Promise<string[]> {
    return this.ask<string[]>('checklist', request);
  }
}
