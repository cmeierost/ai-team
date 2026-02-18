/**
 * Chat manager - handles conversation history and meeting summaries
 */

import fs from 'fs/promises';
import path from 'path';
import {
  ChatMessage,
  MeetingSummary,
  Agent,
} from '../types/index.js';

export class ChatManager {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Get chat history file path for an agent
   * @param agentId - Agent ID
   * @returns Absolute path to JSONL chat file
   */
  private getChatFilePath(agentId: string): string {
    return path.join(
      this.workspaceRoot,
      '.ai-team',
      'private',
      'chats',
      `${agentId}.jsonl`
    );
  }

  /**
   * Load chat history for an agent
   * @param agentId - Agent ID
   * @returns Array of chat messages
   */
  async loadChatHistory(agentId: string): Promise<ChatMessage[]> {
    const filePath = this.getChatFilePath(agentId);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line);
      return lines.map(line => JSON.parse(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []; // No chat history yet
      }
      throw error;
    }
  }

  /**
   * Append message to chat history
   * @param agentId - Agent ID
   * @param message - Chat message to append
   */
  async appendMessage(agentId: string, message: ChatMessage): Promise<void> {
    const filePath = this.getChatFilePath(agentId);
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    
    // Append as JSONL (one JSON object per line)
    const line = JSON.stringify(message) + '\n';
    await fs.appendFile(filePath, line, 'utf-8');
  }

  /**
   * Clear chat history for an agent
   * @param agentId - Agent ID
   */
  async clearChatHistory(agentId: string): Promise<void> {
    const filePath = this.getChatFilePath(agentId);
    
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Save a meeting summary to a markdown file (committed to git)
   * @param summary - Meeting summary data
   * @returns Path to created file
   */
  async saveMeetingSummary(summary: MeetingSummary): Promise<string> {
    const fileName = `${summary.date}-${summary.type}.md`;
    const filePath = path.join(
      this.workspaceRoot,
      '.ai-team',
      'meetings',
      fileName
    );

    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Format as markdown
    const content = this.formatMeetingSummary(summary);
    await fs.writeFile(filePath, content, 'utf-8');

    return filePath;
  }

  /**
   * Format meeting summary as markdown
   */
  private formatMeetingSummary(summary: MeetingSummary): string {
    let md = `# ${summary.title}\n\n`;
    md += `**Date:** ${summary.date}\n`;
    md += `**Type:** ${summary.type}\n`;
    md += `**Participants:** ${summary.participants.join(', ')}\n`;
    if (summary.duration) {
      md += `**Duration:** ${summary.duration}\n`;
    }
    md += '\n---\n\n';

    md += `## Summary\n\n${summary.summary}\n\n`;

    if (summary.keyPoints && summary.keyPoints.length > 0) {
      md += `## Key Points\n\n`;
      for (const point of summary.keyPoints) {
        md += `- ${point}\n`;
      }
      md += '\n';
    }

    if (summary.decisions && summary.decisions.length > 0) {
      md += `## Decisions\n\n`;
      for (const decision of summary.decisions) {
        md += `### ${decision.type}\n`;
        md += `${decision.description}\n`;
        if (decision.rationale) {
          md += `\n*Rationale:* ${decision.rationale}\n`;
        }
        md += '\n';
      }
    }

    if (summary.actionItems && summary.actionItems.length > 0) {
      md += `## Action Items\n\n`;
      for (const item of summary.actionItems) {
        const status = item.completed ? '[x]' : '[ ]';
        md += `- ${status} **${item.assignee}**: ${item.task}\n`;
      }
      md += '\n';
    }

    if (summary.relatedFiles && summary.relatedFiles.length > 0) {
      md += `## Related Files\n\n`;
      for (const file of summary.relatedFiles) {
        md += `- \`${file}\`\n`;
      }
      md += '\n';
    }

    if (summary.chatSession) {
      md += `## Chat Session\n\n`;
      md += `Full conversation logged in: \`${summary.chatSession}\`\n`;
    }

    return md;
  }

  /**
   * Load all meeting summaries
   * @returns Array of meeting summary file paths
   */
  async loadMeetingSummaries(): Promise<string[]> {
    const meetingsDir = path.join(this.workspaceRoot, '.ai-team', 'meetings');
    
    try {
      const files = await fs.readdir(meetingsDir);
      return files
        .filter(f => f.endsWith('.md'))
        .map(f => path.join(meetingsDir, f));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get recent chat messages for an agent
   * @param agentId - Agent ID
   * @param count - Number of recent messages to retrieve
   */
  async getRecentMessages(agentId: string, count: number = 10): Promise<ChatMessage[]> {
    const history = await this.loadChatHistory(agentId);
    return history.slice(-count);
  }
}
