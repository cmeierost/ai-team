/**
 * Chat manager - handles message annotations, summaries, and context curation.
 * Delegates message storage to ChatStorage.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import {
  ChatMessage,
  AnnotatedChatMessage,
  MessageAnnotation,
  ChatSummary,
  ArtifactReference,
  MessageStats,
} from '@ai-team/core';
import { ChatStorage } from './chat-storage.js';

export class ChatManager {
  constructor(
    private readonly storage: ChatStorage,
    private readonly workspaceRoot: string
  ) {}

  /**
   * Get summaries directory path
   */
  private getSummariesDir(): string {
    return path.join(this.workspaceRoot, '.ai-team', 'artifacts', 'summaries');
  }

  /**
   * Archive a message (mark as not sent to LLM)
   */
  async archiveMessage(agentId: string, messageIndex: number): Promise<void> {
    await this.updateMessageField(agentId, messageIndex, 'archived', true);
  }

  /**
   * Unarchive a message
   */
  async unarchiveMessage(agentId: string, messageIndex: number): Promise<void> {
    await this.updateMessageField(agentId, messageIndex, 'archived', false);
  }

  /**
   * Update a specific field in a message
   */
  private async updateMessageField(
    agentId: string,
    messageIndex: number,
    field: string,
    value: any
  ): Promise<ChatMessage> {
    const messages = await this.loadAllMessages(agentId);

    if (messageIndex < 0 || messageIndex >= messages.length) {
      throw new Error(`Message index ${messageIndex} out of bounds`);
    }

    messages[messageIndex] = {
      ...messages[messageIndex],
      [field]: value,
    };

    await this.storage.saveMessages(agentId, messages);
    return messages[messageIndex];
  }

  /**
   * Load all messages (including archived) for an agent
   */
  async loadAllMessages(agentId: string): Promise<ChatMessage[]> {
    return this.storage.loadChatHistory(agentId, true);
  }

  /**
   * Load active (non-archived) messages for an agent
   */
  async loadActiveMessages(agentId: string): Promise<ChatMessage[]> {
    return this.storage.loadChatHistory(agentId, false);
  }

  /**
   * Edit a message's content
   */
  async editMessage(
    agentId: string,
    messageIndex: number,
    newContent: string
  ): Promise<ChatMessage> {
    return this.updateMessageField(agentId, messageIndex, 'content', newContent);
  }

  /**
   * Delete a message
   */
  async deleteMessage(agentId: string, messageIndex: number): Promise<void> {
    const messages = await this.loadAllMessages(agentId);

    if (messageIndex < 0 || messageIndex >= messages.length) {
      throw new Error(`Message index ${messageIndex} out of bounds`);
    }

    messages.splice(messageIndex, 1);
    await this.storage.saveMessages(agentId, messages);
  }

  /**
   * Add annotation to a message
   */
  async addAnnotation(
    agentId: string,
    messageIndex: number,
    annotation: MessageAnnotation
  ): Promise<void> {
    const messages = await this.loadAllMessages(agentId);

    if (messageIndex < 0 || messageIndex >= messages.length) {
      throw new Error(`Message index ${messageIndex} out of bounds`);
    }

    const message = messages[messageIndex] as AnnotatedChatMessage;
    message.annotations = message.annotations || [];
    message.annotations.push(annotation);

    await this.storage.saveMessages(agentId, messages);
  }

  /**
   * Create a summary from selected messages
   */
  async createSummary(
    agentId: string,
    messageIndices: number[],
    title: string,
    tags?: string[]
  ): Promise<ChatSummary> {
    const messages = await this.loadAllMessages(agentId);
    const selectedMessages = messageIndices
      .filter((idx) => idx >= 0 && idx < messages.length)
      .map((idx) => messages[idx]);

    if (selectedMessages.length === 0) {
      throw new Error('No valid messages selected for summary');
    }

    // Generate summary content from selected messages
    const content = this.generateSummaryContent(selectedMessages);

    const summary: ChatSummary = {
      id: `summary-${Date.now()}`,
      title,
      content,
      sourceMessages: {
        agentId,
        messageIndices,
      },
      timestamp: new Date().toISOString(),
      tags,
    };

    // Save summary as markdown with frontmatter
    await this.saveSummary(summary);

    return summary;
  }

  /**
   * Generate summary content from messages
   */
  private generateSummaryContent(messages: ChatMessage[]): string {
    return messages
      .map((msg, idx) => {
        const speaker = msg.from === 'human' ? 'User' : msg.from;
        return `**${speaker}:** ${msg.content}`;
      })
      .join('\n\n');
  }

  /**
   * Save summary as markdown with frontmatter
   */
  private async saveSummary(summary: ChatSummary): Promise<void> {
    const summariesDir = this.getSummariesDir();
    await fs.mkdir(summariesDir, { recursive: true });

    const fileName = `${summary.id}.md`;
    const filePath = path.join(summariesDir, fileName);

    const frontmatter = {
      id: summary.id,
      title: summary.title,
      timestamp: summary.timestamp,
      sourceMessages: summary.sourceMessages,
      tags: summary.tags || [],
    };

    const fileContent = matter.stringify(summary.content, frontmatter);
    await fs.writeFile(filePath, fileContent, 'utf-8');
  }

  /**
   * Load all summaries
   */
  async loadSummaries(): Promise<ChatSummary[]> {
    const summariesDir = this.getSummariesDir();

    try {
      const files = await fs.readdir(summariesDir);
      const summaries: ChatSummary[] = [];

      for (const file of files) {
        if (file.endsWith('.md')) {
          const filePath = path.join(summariesDir, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const parsed = matter(content);

          summaries.push({
            id: parsed.data.id,
            title: parsed.data.title,
            content: parsed.content,
            sourceMessages: parsed.data.sourceMessages,
            timestamp: parsed.data.timestamp,
            tags: parsed.data.tags,
          });
        }
      }

      return summaries;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get message statistics
   */
  async getMessageStats(agentId: string): Promise<MessageStats> {
    const messages = await this.loadAllMessages(agentId);
    const archived = messages.filter((msg) => msg.archived).length;

    return {
      total: messages.length,
      archived,
      active: messages.length - archived,
      byAgent: {
        [agentId]: messages.length,
      },
    };
  }

  /**
   * List available artifacts (summaries, documents, etc.)
   */
  async listArtifacts(): Promise<ArtifactReference[]> {
    const summaries = await this.loadSummaries();

    return summaries.map((summary) => ({
      type: 'summary' as const,
      path: path.join(this.getSummariesDir(), `${summary.id}.md`),
      title: summary.title,
      tags: summary.tags,
    }));
  }
}
