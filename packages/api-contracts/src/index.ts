// Re-export all contracts (DTOs, enums, service interfaces)
export * from './contract/index.js';
export type { QuestionHandlerMap as IQuestionListeners } from './contract/routers/streaming.js';

/** Response from `ide.openDiff`. Matches the actual server return shape. */
export interface IdeOpenDiffResponse {
  sessionId: string;
  state: string;
}

// ─── HTTP client (browser/remote transport) ──────────────────────────────────
export {
  createAiTeamClient,
  ApiHttpError,
  streamViaWebSocket,
  summarizeNoteViaWebSocket,
} from './http-client.js';
export type { AiTeamHttpClient, WebSocketStreamOptions } from './http-client.js';
export type { SummarizeNoteWebSocketOptions } from './websocket.js';
