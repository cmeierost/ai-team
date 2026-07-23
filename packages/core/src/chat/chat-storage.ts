import { ChatMessage, MeetingSummary } from '../types/index.js';

export interface IChatStorage {
  /**
   * Load chat history for an agent
   * @param agentId - Agent ID
   * @param includeArchived - Include archived messages (default: false)
   * @returns Array of chat messages
   */
  loadChatHistory(agentId: string, includeArchived: boolean): Promise<ChatMessage[]>;
  loadChatHistory(agentId: string): Promise<ChatMessage[]>;

  /**
   * Append message to chat history
   * @param agentId - Agent ID
   * @param message - Chat message to append
   */
  appendMessage(agentId: string, message: ChatMessage): Promise<void>;

  /**
   * Clear chat history for an agent
   * @param agentId - Agent ID
   */
  clearChatHistory(agentId: string): Promise<void>;

  /**
   * Save a meeting summary to a markdown file (committed to git)
   * @param summary - Meeting summary data
   * @returns Path to created file
   */
  saveMeetingSummary(summary: MeetingSummary): Promise<string>;

  /**
   * Load all meeting summaries
   * @returns Array of meeting summary file paths
   */
  loadMeetingSummaries(): Promise<string[]>;

  /**
   * Get recent chat messages for an agent
   * @param agentId - Agent ID
   * @param count - Number of recent messages to retrieve
   */
  getRecentMessages(agentId: string, count: number): Promise<ChatMessage[]>;
  getRecentMessages(agentId: string): Promise<ChatMessage[]>;

  /**
   * Overwrite all messages for an agent (used by ChatManager for edits/archives)
   * @param agentId - Agent ID
   * @param messages - Full message list to persist
   */
  saveMessages(agentId: string, messages: ChatMessage[]): Promise<void>;
}
