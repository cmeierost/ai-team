import { promises as fs } from 'fs';
import path from 'path';
import { ChatMessage, ChatSession, Artifact, type AgentManager } from '@ai-team/infrastructure';
import { resolveAgentForOperationAsync } from './utils/agent-resolution.js';
import type { IMessageStorage, SessionSkill } from './storage/contracts.js';

export class SessionManager {
  private workspaceRoot: string;
  private artifactsDir: string;
  private agentManager?: AgentManager;
  private storage: IMessageStorage;

  private artifactsDirReady = false;

  constructor(workspaceRoot: string, storage: IMessageStorage, agentManager?: AgentManager) {
    this.workspaceRoot = workspaceRoot;
    this.artifactsDir = path.join(workspaceRoot, '.ai-team', 'artifacts', 'briefs');
    this.agentManager = agentManager;
    this.storage = storage;
  }

  private async ensureArtifactsDir(): Promise<void> {
    if (!this.artifactsDirReady) {
      await fs.mkdir(this.artifactsDir, { recursive: true });
      this.artifactsDirReady = true;
    }
  }

  /**
   * Close storage connections
   */
  async close(): Promise<void> {
    await this.storage.close();
  }

  /**
   * Create a new session for an agent
   * @param agentQuery - Agent ID, role, name, or partial match
   * @param developerId - Developer ID
   */
  async createSession(agentQuery: string, developerId: string): Promise<ChatSession> {
    // Resolve agent query to exact ID if AgentManager is available
    let agentId = agentQuery;
    if (this.agentManager) {
      const resolved = await resolveAgentForOperationAsync(
        this.agentManager,
        agentQuery,
        'create session'
      );
      agentId = resolved.id;
    }

    const now = new Date().toISOString();
    const session = await this.storage.createSession({
      agentIds: [agentId], // Primary field - array for multi-agent support
      agentId, // Backward compatibility
      developerId,
      startedAt: now,
      lastActivityAt: now,
      artifacts: [],
      allowedFiles: [],
    });

    return session;
  }

  /**
   * Create a new session for a handoff from one agent to another
   * @param toAgentQuery - Target agent ID, role, name, or partial match
   * @param developerId - Developer ID
   * @param previousSessionId - Previous session ID
   * @param transferArtifacts - Whether to transfer artifacts
   * @param transferAllowedFiles - Whether to transfer allowed files
   */
  async createHandoffSession(
    toAgentQuery: string,
    developerId: string,
    previousSessionId: string,
    transferArtifacts: boolean = true,
    transferAllowedFiles: boolean = true
  ): Promise<ChatSession> {
    // Resolve agent query to exact ID if AgentManager is available
    let toAgentId = toAgentQuery;
    if (this.agentManager) {
      const resolved = await resolveAgentForOperationAsync(
        this.agentManager,
        toAgentQuery,
        'create handoff session'
      );
      toAgentId = resolved.id;
    }

    const previousSession = await this.getSession(previousSessionId);

    const now = new Date().toISOString();
    const newSession = await this.storage.createSession({
      agentIds: [toAgentId], // Primary field - array for multi-agent support
      agentId: toAgentId, // Backward compatibility
      developerId,
      startedAt: now,
      lastActivityAt: now,
      artifacts: transferArtifacts && previousSession ? [...previousSession.artifacts] : [],
      allowedFiles:
        transferAllowedFiles && previousSession ? [...previousSession.allowedFiles] : [],
      previousSessionId,
    });

    return newSession;
  }

  /**
   * Resolve the TO session for a handoff, enforcing the one-session-per-agent-per-thread rule.
   *
   * Walks the `previousSessionId` spine from `currentSessionId` back to the root and checks
   * whether the target agent already has a session in this thread. If it does, that session is
   * returned so it can be resumed. If it does not, a new handoff session is created with
   * `previousSessionId = currentSessionId`.
   *
   * In both cases the full briefing sequence (briefing messages + handoffId stamping) still runs —
   * the distinction is only whether a new DB row is created for the session.
   */
  async resolveHandoffSession(
    targetAgentId: string,
    currentSessionId: string,
    developerId: string
  ): Promise<{ session: ChatSession; isNew: boolean }> {
    const chain = await this.getSessionChain(currentSessionId);
    const existing = chain.find((s) => {
      const ids: string[] = (s as any).agentIds ?? (s.agentId ? [(s as any).agentId] : []);
      return ids.includes(targetAgentId);
    });
    if (existing) return { session: existing, isNew: false };

    // First time reaching this agent in this thread — extend the spine.
    const session = await this.createHandoffSession(targetAgentId, developerId, currentSessionId);
    return { session, isNew: true };
  }

  /**
   * Get the latest (most recent) session for an agent
   * @param agentQuery - Agent ID, role, name, or partial match
   */
  async getLatestSession(agentQuery: string): Promise<ChatSession | null> {
    // Resolve agent query to exact ID if AgentManager is available
    let agentId = agentQuery;
    if (this.agentManager) {
      const resolved = await resolveAgentForOperationAsync(
        this.agentManager,
        agentQuery,
        'get latest session'
      );
      agentId = resolved.id;
    }

    try {
      const sessions = await this.storage.listSessions({
        agentId,
        sortBy: 'lastActivityAt',
        sortOrder: 'desc',
        limit: 1,
      });

      return sessions.length > 0 ? sessions[0] : null;
    } catch (error) {
      console.error('Failed to get latest session:', error);
      return null;
    }
  }

  /**
   * List recent sessions across all agents
   * @param limit - Maximum number of sessions to return (default 10)
   */
  async listRecentSessions(limit = 10): Promise<ChatSession[]> {
    try {
      return await this.storage.listSessions({
        sortBy: 'lastActivityAt',
        sortOrder: 'desc',
        limit,
      });
    } catch (error) {
      console.error('Failed to list recent sessions:', error);
      return [];
    }
  }

  /**
   * List all sessions for an agent
   * @param agentQuery - Agent ID, role, name, or partial match
   * @param limit - Maximum number of sessions to return
   */
  async listSessions(agentQuery: string, limit?: number): Promise<ChatSession[]> {
    // Resolve agent query to exact ID if AgentManager is available
    let agentId = agentQuery;
    if (this.agentManager) {
      const resolved = await resolveAgentForOperationAsync(
        this.agentManager,
        agentQuery,
        'list sessions'
      );
      agentId = resolved.id;
    }

    try {
      return await this.storage.listSessions({
        agentId,
        sortBy: 'lastActivityAt',
        sortOrder: 'desc',
        limit,
      });
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
      return await this.storage.getSession(sessionId);
    } catch (error) {
      return null;
    }
  }

  /**
   * Save session metadata
   */
  async saveSession(session: ChatSession): Promise<void> {
    await this.storage.updateSession(session.id, session);
  }

  /**
   * Get messages for a session
   */
  async getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      return await this.storage.getSessionMessages(sessionId);
    } catch (error) {
      // If session doesn't exist, return empty array
      return [];
    }
  }

  /**
   * Append a message to a session
   */
  async appendMessage(sessionId: string, message: ChatMessage): Promise<void> {
    await this.storage.insertMessage(sessionId, message);
  }

  /**
   * Delete a specific message from a session by timestamp.
   * Returns true if a message was deleted.
   */
  async deleteSessionMessage(sessionId: string, messageTimestamp: string): Promise<boolean> {
    return this.storage.deleteMessage(sessionId, messageTimestamp);
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

    // Delete messages from old session (split point onwards)
    // Since we don't have a bulk delete, we need to delete from the end
    for (let i = messages.length - 1; i >= atIndex; i--) {
      await this.storage.deleteMessage(sessionId, messages[i].timestamp);
    }

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

  /**
   * Get or create the latest session for an agent (auto-resume behavior)
   * @param agentId - Agent ID
   * @param developerId - Developer ID
   * @returns Latest existing session or newly created session
   */
  async getOrCreateLatestSession(agentId: string, developerId: string): Promise<ChatSession> {
    // Try to get latest session first
    const latest = await this.getLatestSession(agentId);

    if (latest && latest.developerId === developerId) {
      return latest;
    }

    // No session exists or developer mismatch - create new one
    return await this.createSession(agentId, developerId);
  }

  /**
   * Generate a title for a session using LLM
   * Reads first 2 human + 2 agent messages and generates descriptive title
   * @param sessionId - Session ID
   * @param llmService - LLM service instance for title generation
   * @returns Generated title
   */
  async generateTitle(sessionId: string, llmService: any): Promise<string> {
    const messages = await this.getSessionMessages(sessionId);

    // Get first 2 human and 2 agent messages for context
    const humanMessages = messages.filter((m) => m.isHuman).slice(0, 2);
    const agentMessages = messages.filter((m) => !m.isHuman).slice(0, 2);
    const contextMessages = [...humanMessages, ...agentMessages]
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(0, 4);

    if (contextMessages.length === 0) {
      return 'New Conversation';
    }

    // Use LLM to generate title
    const title = await llmService.generateTitle(contextMessages);

    // Update session with title
    const session = await this.getSession(sessionId);
    if (session) {
      session.title = title;
      await this.saveSession(session);
    }

    return title;
  }

  /**
   * Add an agent to an existing session (multi-agent mode)
   * @param sessionId - Session ID
   * @param agentId - Agent ID to add
   */
  async addAgentToSession(sessionId: string, agentId: string): Promise<ChatSession> {
    await this.storage.addSessionAgent(sessionId, agentId);

    // Update lastActivityAt
    await this.storage.updateSession(sessionId, {
      lastActivityAt: new Date().toISOString(),
    });

    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return session;
  }

  /**
   * Merge two sessions - combines messages from newer session into older one
   * @param olderSessionId - Target session (will receive all messages)
   * @param newerSessionId - Source session (will be deleted)
   */
  async mergeSessionsIntoOlder(
    olderSessionId: string,
    newerSessionId: string
  ): Promise<ChatSession> {
    const olderSession = await this.getSession(olderSessionId);
    const newerSession = await this.getSession(newerSessionId);

    if (!olderSession || !newerSession) {
      throw new Error('Both sessions must exist');
    }

    if (olderSession.developerId !== newerSession.developerId) {
      throw new Error('Cannot merge sessions from different developers');
    }

    // Load messages from newer session and copy to older
    const newerMessages = await this.getSessionMessages(newerSessionId);
    for (const message of newerMessages) {
      await this.storage.insertMessage(olderSessionId, message);
    }

    // Merge agentIds arrays
    const mergedAgentIds = new Set([...olderSession.agentIds, ...newerSession.agentIds]);

    for (const agentId of mergedAgentIds) {
      await this.storage.addSessionAgent(olderSessionId, agentId);
    }

    // Track merge history and merge artifacts/files
    const mergedFromSessionIds = [
      ...(olderSession.mergedFromSessionIds || []),
      newerSessionId,
      ...(newerSession.mergedFromSessionIds || []),
    ];

    await this.storage.updateSession(olderSessionId, {
      lastActivityAt: new Date().toISOString(),
      mergedFromSessionIds,
      artifacts: [...new Set([...olderSession.artifacts, ...newerSession.artifacts])],
      allowedFiles: [...new Set([...olderSession.allowedFiles, ...newerSession.allowedFiles])],
    });

    // Delete newer session
    await this.storage.deleteSession(newerSessionId);

    const updatedSession = await this.getSession(olderSessionId);
    if (!updatedSession) {
      throw new Error(`Failed to retrieve merged session ${olderSessionId}`);
    }

    return updatedSession;
  }

  /**
   * Walk the previousSessionId chain from the given session back to the root.
   * Returns sessions ordered root → leaf (oldest first).
   * A visited-set guards against corrupt data cycles.
   */
  async getSessionChain(sessionId: string): Promise<ChatSession[]> {
    // 1. Walk upward to find the root session.
    const upwardChain: ChatSession[] = [];
    const visited = new Set<string>();
    let current: ChatSession | null = await this.getSession(sessionId);

    while (current) {
      if (visited.has(current.id)) break; // cycle guard
      visited.add(current.id);
      upwardChain.push(current);
      if (!current.previousSessionId) break;
      current = await this.getSession(current.previousSessionId);
    }

    upwardChain.reverse(); // root first
    const root = upwardChain[0];
    if (!root) return [];

    // 2. BFS downward from root to collect all descendants.
    // This gives the full connected graph the caller is part of, regardless
    // of which session they started from.
    const allSessions = await this.storage.listSessions(
      root.developerId ? { developerId: root.developerId } : undefined
    );

    const childrenOf = new Map<string, ChatSession[]>();
    for (const s of allSessions) {
      if (!s.previousSessionId) continue;
      const children = childrenOf.get(s.previousSessionId) ?? [];
      children.push(s);
      childrenOf.set(s.previousSessionId, children);
    }

    // BFS from root
    const result: ChatSession[] = [];
    const queue: ChatSession[] = [root];
    const seen = new Set<string>([root.id]);

    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node);
      for (const child of childrenOf.get(node.id) ?? []) {
        if (!seen.has(child.id)) {
          seen.add(child.id);
          queue.push(child);
        }
      }
    }

    return result;
  }

  /**
   * Walk the session chain from the given session to the root and return the
   * first session that belongs to the specified agent. Returns null if no such
   * session exists in the chain.
   *
   * This is used by the handoff logic to avoid creating a duplicate session
   * when the developer is sent back to an agent they have already spoken with
   * earlier in the same thread (e.g. Alex → Michael → Alex → Michael should
   * reuse Michael's first session, not open a third one).
   */
  async findAgentSessionInChain(
    fromSessionId: string,
    agentId: string
  ): Promise<ChatSession | null> {
    const visited = new Set<string>();
    let current: ChatSession | null = await this.getSession(fromSessionId);

    while (current) {
      if (visited.has(current.id)) break; // cycle guard
      visited.add(current.id);

      const ids: string[] = current.agentIds?.length
        ? current.agentIds
        : current.agentId
          ? [current.agentId]
          : [];

      if (ids.includes(agentId)) return current;

      if (!current.previousSessionId) break;
      current = await this.getSession(current.previousSessionId);
    }

    return null;
  }

  /**
   * Delete a session and all its messages
   * @param sessionId - Session ID to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.storage.deleteSession(sessionId);
  }

  // ========== Session Skills ==========

  async addSessionSkill(sessionId: string, skillPath: string): Promise<void> {
    await this.storage.addSessionSkill(sessionId, skillPath);
  }

  async getSessionSkills(sessionId: string): Promise<SessionSkill[]> {
    return this.storage.getSessionSkills(sessionId);
  }

  async setSessionSkillPaused(
    sessionId: string,
    skillPath: string,
    paused: boolean
  ): Promise<void> {
    await this.storage.setSessionSkillPaused(sessionId, skillPath, paused);
  }

  async updateToolCallLlmResult(toolCallId: number, newText: string): Promise<void> {
    await this.storage.updateToolCallLlmResult(toolCallId, newText);
  }
}
