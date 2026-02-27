import { promises as fs } from 'fs';
import path from 'path';
import { ChatMessage, ChatSession, Artifact } from '@ai-team/core';
import { randomBytes } from 'crypto';

export class SessionManager {
  private workspaceRoot: string;
  private sessionsDir: string;
  private artifactsDir: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.sessionsDir = path.join(workspaceRoot, '.ai-team', 'private', 'sessions');
    this.artifactsDir = path.join(workspaceRoot, '.ai-team', 'artifacts', 'briefs');
  }

  /**
   * Initialize directories for sessions and artifacts
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.mkdir(this.artifactsDir, { recursive: true });
  }

  /**
   * Generate a unique session ID
   */
  private generateSessionId(): string {
    const date = new Date().toISOString().split('T')[0]; // "2026-02-27"
    const random = randomBytes(6).toString('hex'); // "abc123def456"
    return `session-${date}-${random}`;
  }

  /**
   * Create a new session for an agent
   */
  async createSession(agentId: string, developerId: string): Promise<ChatSession> {
    const session: ChatSession = {
      id: this.generateSessionId(),
      agentId,
      developerId,
      startedAt: new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
      messageCount: 0,
      artifacts: [],
      allowedFiles: [],
    };

    await this.saveSession(session);
    return session;
  }

  /**
   * Get the latest (most recent) session for an agent
   */
  async getLatestSession(agentId: string): Promise<ChatSession | null> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessionFiles = files.filter((f) => f.endsWith('.json'));

      // Load all sessions for this agent and find the latest
      const sessions: ChatSession[] = [];
      for (const file of sessionFiles) {
        const sessionPath = path.join(this.sessionsDir, file);
        const data = await fs.readFile(sessionPath, 'utf-8');
        const session: ChatSession = JSON.parse(data);
        if (session.agentId === agentId) {
          sessions.push(session);
        }
      }

      if (sessions.length === 0) {
        return null;
      }

      // Sort by lastActivityAt descending and return the most recent
      sessions.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());
      return sessions[0];
    } catch (error) {
      console.error('Failed to get latest session:', error);
      return null;
    }
  }

  /**
   * List all sessions for an agent
   */
  async listSessions(agentId: string, limit?: number): Promise<ChatSession[]> {
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessionFiles = files.filter((f) => f.endsWith('.json'));

      const sessions: ChatSession[] = [];
      for (const file of sessionFiles) {
        const sessionPath = path.join(this.sessionsDir, file);
        const data = await fs.readFile(sessionPath, 'utf-8');
        const session: ChatSession = JSON.parse(data);
        if (session.agentId === agentId) {
          sessions.push(session);
        }
      }

      // Sort by lastActivityAt descending (most recent first)
      sessions.sort((a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime());

      // Apply limit if specified
      return limit ? sessions.slice(0, limit) : sessions;
    } catch (error) {
      console.error('Failed to list sessions:', error);
      return [];
    }
  }

  /**
   * Load a session by ID
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    try {
      const sessionPath = path.join(this.sessionsDir, `${sessionId}.json`);
      const data = await fs.readFile(sessionPath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  /**
   * Save session metadata
   */
  async saveSession(session: ChatSession): Promise<void> {
    const sessionPath = path.join(this.sessionsDir, `${session.id}.json`);
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Get messages for a session
   */
  async getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      const messagesPath = path.join(this.sessionsDir, `${sessionId}.jsonl`);
      const data = await fs.readFile(messagesPath, 'utf-8');
      const lines = data.trim().split('\n').filter((line) => line.length > 0);
      return lines.map((line) => JSON.parse(line));
    } catch (error) {
      // If file doesn't exist yet, return empty array
      return [];
    }
  }

  /**
   * Append a message to a session
   */
  async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
    const messagesPath = path.join(this.sessionsDir, `${sessionId}.jsonl`);
    const line = JSON.stringify(message) + '\n';
    await fs.appendFile(messagesPath, line, 'utf-8');

    // Update session metadata
    const session = await this.getSession(sessionId);
    if (session) {
      session.lastActivityAt = new Date().toISOString();
      session.messageCount++;
      await this.saveSession(session);
    }
  }

  /**
   * Split a session at a specific message index
   * Creates a new session starting from the split point
   */
  async splitSession(
    sessionId: string,
    atIndex: number,
    developerId: string
  ): Promise<ChatSession> {
    const currentSession = await this.getSession(sessionId);
    if (!currentSession) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const messages = await this.getSessionMessages(sessionId);
    if (atIndex < 0 || atIndex >= messages.length) {
      throw new Error(`Invalid split index ${atIndex}`);
    }

    // Create new session
    const newSession = await this.createSession(currentSession.agentId, developerId);

    // Copy messages from split point to new session
    const newMessages = messages.slice(atIndex);
    for (const message of newMessages) {
      await this.appendMessage(newSession.id, message);
    }

    // Update old session: truncate messages to split point
    const remainingMessages = messages.slice(0, atIndex);
    const messagesPath = path.join(this.sessionsDir, `${sessionId}.jsonl`);
    const content = remainingMessages.map((m) => JSON.stringify(m)).join('\n') + '\n';
    await fs.writeFile(messagesPath, content, 'utf-8');

    // Update old session metadata
    currentSession.messageCount = remainingMessages.length;
    await this.saveSession(currentSession);

    return newSession;
  }

  /**
   * Create an artifact/brief from a range of messages
   */
  async createArtifact(
    sessionId: string,
    fromIndex: number,
    toIndex: number,
    summary: string,
    title: string,
    developerId: string
  ): Promise<Artifact> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    // Generate artifact ID from title (kebab-case)
    const artifactId = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 50);

    const timestamp = Date.now();
    const filename = `${artifactId}-${timestamp}.md`;
    const filepath = path.join(this.artifactsDir, filename);

    // Build artifact content
    const content = `# ${title}

**Created:** ${new Date().toISOString()}
**Session:** ${sessionId}
**Created by:** ${developerId}
**Messages:** ${fromIndex} - ${toIndex}

---

${summary}
`;

    // Save artifact file
    await fs.writeFile(filepath, content, 'utf-8');

    const artifact: Artifact = {
      id: artifactId,
      type: 'brief',
      title,
      content: summary,
      createdAt: new Date().toISOString(),
      createdBy: developerId,
      sourceSessionId: sessionId,
      fromMessageIndex: fromIndex,
      toMessageIndex: toIndex,
      filepath: path.relative(this.workspaceRoot, filepath),
    };

    // Add artifact to session
    if (!session.artifacts.includes(artifactId)) {
      session.artifacts.push(artifactId);
      await this.saveSession(session);
    }

    return artifact;
  }

  /**
   * List all artifacts
   */
  async listArtifacts(): Promise<Artifact[]> {
    try {
      const files = await fs.readdir(this.artifactsDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      const artifacts: Artifact[] = [];
      for (const file of mdFiles) {
        const filepath = path.join(this.artifactsDir, file);
        const content = await fs.readFile(filepath, 'utf-8');

        // Parse frontmatter-like metadata
        const titleMatch = content.match(/^# (.+)$/m);
        const createdMatch = content.match(/\*\*Created:\*\* (.+)$/m);
        const sessionMatch = content.match(/\*\*Session:\*\* (.+)$/m);
        const createdByMatch = content.match(/\*\*Created by:\*\* (.+)$/m);
        const messagesMatch = content.match(/\*\*Messages:\*\* (\d+) - (\d+)$/m);

        if (titleMatch && createdMatch && sessionMatch && createdByMatch && messagesMatch) {
          const summaryContent = content.split('---\n')[1]?.trim() || '';
          artifacts.push({
            id: file.replace(/-.+\.md$/, ''),
            type: 'brief',
            title: titleMatch[1],
            content: summaryContent,
            createdAt: createdMatch[1],
            createdBy: createdByMatch[1],
            sourceSessionId: sessionMatch[1],
            fromMessageIndex: parseInt(messagesMatch[1], 10),
            toMessageIndex: parseInt(messagesMatch[2], 10),
            filepath: path.relative(this.workspaceRoot, filepath),
          });
        }
      }

      return artifacts;
    } catch (error) {
      console.error('Failed to list artifacts:', error);
      return [];
    }
  }

  /**
   * Get artifact by ID
   */
  async getArtifact(artifactId: string): Promise<Artifact | null> {
    const artifacts = await this.listArtifacts();
    return artifacts.find((a) => a.id === artifactId) || null;
  }
}
