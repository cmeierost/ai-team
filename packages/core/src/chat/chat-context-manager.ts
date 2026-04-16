import {
  ChatMessage,
  MessageAnnotation,
  ChatSummary,
  ArtifactReference,
  MessageStats,
} from '../types/index.js';

export interface IChatManager {
  /**
   * Archive a message (mark as not sent to LLM)
   */
  archiveMessage(agentId: string, messageIndex: number): Promise<void>;

  /**
   * Unarchive a message
   */
  unarchiveMessage(agentId: string, messageIndex: number): Promise<void>;

  /**
   * Load all messages (including archived) for an agent
   */
  loadAllMessages(agentId: string): Promise<ChatMessage[]>;

  /**
   * Load active (non-archived) messages for an agent
   */
  loadActiveMessages(agentId: string): Promise<ChatMessage[]>;

  /**
   * Edit a message's content
   */
  editMessage(agentId: string, messageIndex: number, newContent: string): Promise<void>;

  /**
   * Delete a message
   */
  deleteMessage(agentId: string, messageIndex: number): Promise<void>;

  /**
   * Add annotation to a message
   */
  addAnnotation(
    agentId: string,
    messageIndex: number,
    annotation: MessageAnnotation
  ): Promise<void>;

  /**
   * Create a summary from selected messages
   */
  createSummary(
    agentId: string,
    messageIndices: number[],
    title: string,
    tags?: string[]
  ): Promise<ChatSummary>;

  /**
   * Load all summaries
   */
  loadSummaries(): Promise<ChatSummary[]>;

  /**
   * Get message statistics
   */
  getMessageStats(agentId: string): Promise<MessageStats>;

  /**
   * List available artifacts (summaries, documents, etc.)
   */
  listArtifacts(): Promise<ArtifactReference[]>;
}
