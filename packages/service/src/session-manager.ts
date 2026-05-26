import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ChatMessage, ChatSession, Artifact } from '@ai-team/core';
import type {
  IMessagesRepository,
  ISessionsRepository,
  INotesRepository,
  IAgentManager,
  INoteAttachmentReader,
} from '@ai-team/core';
import type { HandoffEdge } from '@ai-team/api-contracts';
import type {
  MessageSessionLink,
  Note,
  NoteAttachment,
  NoteCreateInput,
  NoteUpdateInput,
  NoteSessionShare,
  NoteSessionShareKind,
  SessionDeleteImpact,
  SessionDeleteOptions,
  SessionSkill,
} from '@ai-team/core';

export interface SessionThreadGraphSession {
  sessionId: string;
  agentIds: string[];
  developerId: string | null;
  title: string | null;
  startedAt: string;
  lastActivityAt: string;
  previousSessionId: string | null;
  mergedFromSessionIds: string[] | null;
  messageCount: number;
  messages: ChatMessage[];
}

export interface SessionThreadGraphData {
  rootSessionId: string;
  depth: number;
  sessions: SessionThreadGraphSession[];
  handoffs: HandoffEdge[];
}

export class SessionManager {
  private readonly artifactsDir: string;
  private autoTitleLlmService?: any;

  private artifactsDirReady = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly messages: IMessagesRepository,
    private readonly sessions: ISessionsRepository,
    private readonly notes: INotesRepository,
    private readonly agentManager?: IAgentManager,
    private readonly attachmentReader?: INoteAttachmentReader
  ) {
    this.artifactsDir = path.join(this.workspaceRoot, '.ai-team', 'artifacts', 'briefs');
  }

  private getAttachmentReader(): INoteAttachmentReader {
    if (!this.attachmentReader) {
      throw new Error('SessionManager requires an attachment reader for note attachment workflows.');
    }
    return this.attachmentReader;
  }

  setAutoTitleLlmService(llmService: any): void {
    this.autoTitleLlmService = llmService;
  }

  private async ensureArtifactsDir(): Promise<void> {
    if (!this.artifactsDirReady) {
      await fs.mkdir(this.artifactsDir, { recursive: true });
      this.artifactsDirReady = true;
    }
  }

  /**
   * Close storage connections - no-op here; lifecycle managed by container
   */
  async close(): Promise<void> {
    // lifecycle managed by container via SqliteMessageStorage
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
      const resolved = await this.agentManager.resolveAgentForOperationAsync(
        agentQuery,
        'create session'
      );
      agentId = resolved.id;
    }

    const now = new Date().toISOString();
    const session = await this.sessions.createSession({
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
      const resolved = await this.agentManager.resolveAgentForOperationAsync(
        toAgentQuery,
        'create handoff session'
      );
      toAgentId = resolved.id;
    }

    const previousSession = await this.getSession(previousSessionId);

    const now = new Date().toISOString();
    const newSession = await this.sessions.createSession({
      agentIds: [toAgentId], // Primary field - array for multi-agent support
      agentId: toAgentId, // Backward compatibility
      developerId,
      startedAt: now,
      lastActivityAt: now,
      title: previousSession?.title,
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
    let agentId = agentQuery;
    if (this.agentManager) {
      const resolved = await this.agentManager.resolveAgentForOperationAsync(
        agentQuery,
        'get latest session'
      );
      agentId = resolved.id;
    }

    try {
      const sessions = await this.sessions.listSessions({
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
      return await this.sessions.listSessions({
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
      const resolved = await this.agentManager.resolveAgentForOperationAsync(
        agentQuery,
        'list sessions'
      );
      agentId = resolved.id;
    }

    try {
      return await this.sessions.listSessions({
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
      return await this.sessions.getSession(sessionId);
    } catch (error) {
      return null;
    }
  }

  /**
   * Save session metadata
   */
  async saveSession(session: ChatSession): Promise<void> {
    await this.sessions.updateSession(session.id, session);
  }

  /**
   * Get messages for a session
   */
  async getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      return await this.messages.getSessionMessages(sessionId);
    } catch (error) {
      // If session doesn't exist, return empty array
      return [];
    }
  }

  /**
   * Get all persisted messages for a session, including archived ones.
   */
  async listSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      return await this.messages.queryMessages({ sessionId });
    } catch {
      return [];
    }
  }

  async getMessageById(messageId: number): Promise<ChatMessage | null> {
    try {
      return await this.messages.getMessageById(messageId);
    } catch {
      return null;
    }
  }

  async setMessageHiddenFromLlm(messageId: number, hidden: boolean): Promise<boolean> {
    try {
      return await this.messages.setMessageHiddenFromLlm(messageId, hidden);
    } catch {
      return false;
    }
  }

  async updateMessageContent(messageId: number, newContent: string): Promise<boolean> {
    try {
      return await this.messages.updateMessageContent(messageId, newContent);
    } catch {
      return false;
    }
  }

  /**
   * Append a message to a session.
   * If the session has no title yet and the total message count reaches 3 or more
   * after inserting this message, a title is generated via the provided llmService
   * and saved to the session. Returns the generated title, or null otherwise.
   */
  async appendMessage(
    sessionId: string,
    message: ChatMessage,
    llmService?: any
  ): Promise<string | null> {
    await this.messages.insertMessage(sessionId, message);

    const effectiveLlmService = llmService ?? this.autoTitleLlmService;
    if (!effectiveLlmService) return null;

    try {
      const session = await this.sessions.getSession(sessionId);
      if (!session || session.title) return null;

      const existingThreadTitle = await this.getExistingThreadTitle(sessionId);
      if (existingThreadTitle) {
        await this.applyThreadTitle(sessionId, existingThreadTitle);
        return existingThreadTitle;
      }

      // Generate only after we have enough user intent signal.
      const humanMessages = await this.messages.queryMessages({
        sessionId,
        isHuman: true,
        limit: 2,
      });
      if (humanMessages.length < 2) return null;

      return await this.generateTitle(sessionId, effectiveLlmService);
    } catch (err) {
      console.error('[SessionManager] Auto-title generation failed:', err);
      return null;
    }
  }

  /**
   * Delete a specific message from a session by timestamp.
   * Returns true if a message was deleted.
   */
  async deleteSessionMessage(sessionId: string, messageTimestamp: string): Promise<boolean> {
    return this.messages.deleteMessage(sessionId, messageTimestamp);
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
      await this.messages.deleteMessage(sessionId, messages[i].timestamp);
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
    const existingThreadTitle = await this.getExistingThreadTitle(sessionId);
    if (existingThreadTitle) {
      await this.applyThreadTitle(sessionId, existingThreadTitle);
      return existingThreadTitle;
    }

    // Use only the first 2 human messages — agent intro messages add noise, not signal.
    const humanMessages = await this.messages.queryMessages({ sessionId, isHuman: true, limit: 2 });
    const contextMessages = humanMessages.filter((m) => m.content?.trim());

    const fallbackTitle = this.buildFallbackActionTitle(contextMessages);

    let title = fallbackTitle;
    if (contextMessages.length > 0) {
      try {
        // Use LLM to generate title
        const generated = await llmService.generateTitle(contextMessages);
        const normalized = this.normalizeTitle(generated);
        title = normalized && !this.isWeakGeneratedTitle(normalized) ? normalized : fallbackTitle;
      } catch (error) {
        console.warn('[SessionManager] Title generation failed, using fallback title.', error);
      }
    }

    await this.applyThreadTitle(sessionId, title);

    return title;
  }

  async setThreadTitle(sessionId: string, title: string): Promise<void> {
    await this.applyThreadTitle(sessionId, title);
  }

  private async getExistingThreadTitle(sessionId: string): Promise<string | null> {
    const chain = await this.getSessionChain(sessionId);
    for (const session of chain) {
      const normalized = this.normalizeTitle(session.title ?? '');
      if (normalized) {
        return normalized;
      }
    }
    return null;
  }

  private async applyThreadTitle(sessionId: string, title: string): Promise<void> {
    const normalizedTitle = this.normalizeTitle(title);
    if (!normalizedTitle) {
      return;
    }

    const chain = await this.getSessionChain(sessionId);
    await Promise.all(
      chain
        .filter((session) => this.normalizeTitle(session.title ?? '') !== normalizedTitle)
        .map((session) => this.sessions.updateSession(session.id, { title: normalizedTitle }))
    );
  }

  private normalizeTitle(input: string | undefined | null): string {
    if (!input) return '';
    return input
      .replaceAll(/[\r\n\t]+/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .replaceAll(/^['"\u2018\u2019\u201C\u201D]+|['"\u2018\u2019\u201C\u201D]+$/g, '')
      .trim();
  }

  private buildFallbackActionTitle(messages: ChatMessage[]): string {
    const source = messages
      .filter((m) => m.isHuman)
      .map((m) => m.content ?? '')
      .join(' ')
      .toLowerCase();

    const stopwords = new Set([
      'a',
      'an',
      'and',
      'are',
      'as',
      'at',
      'be',
      'by',
      'for',
      'from',
      'how',
      'i',
      'in',
      'is',
      'it',
      'let',
      'lets',
      'my',
      'of',
      'on',
      'or',
      'the',
      'this',
      'to',
      'we',
      'with',
      'future',
      'you',
      'me',
      'please',
      'can',
      'could',
      'would',
      'should',
      'need',
      'want',
    ]);

    const actionVerbMap: Record<string, string> = {
      fix: 'Fix',
      create: 'Create',
      add: 'Add',
      update: 'Update',
      improve: 'Improve',
      refactor: 'Refactor',
      debug: 'Debug',
      test: 'Test',
      write: 'Write',
      implement: 'Implement',
      build: 'Build',
      generate: 'Generate',
      set: 'Set',
      make: 'Make',
      plan: 'Plan',
      retire: 'Retire',
      retiring: 'Retire',
      archive: 'Archive',
      offboard: 'Offboard',
      decommission: 'Decommission',
      sunset: 'Sunset',
    };

    const words = source
      .replaceAll(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    const hasAgentToken = words.some((w) => w === 'agent' || w === 'agents');
    const hasRetirementToken = words.some((w) =>
      [
        'retire',
        'retiring',
        'retirement',
        'archive',
        'offboard',
        'decommission',
        'sunset',
      ].includes(w)
    );
    if (hasAgentToken && hasRetirementToken) {
      return 'Plan Agent Retirement';
    }

    let action = 'Improve';
    const actionWord = words.find((w) => actionVerbMap[w]);
    if (actionWord) {
      action = actionVerbMap[actionWord];
    }

    const topicWords: string[] = [];
    const seen = new Set<string>();
    for (const word of words) {
      if (word.length < 3 || stopwords.has(word) || actionVerbMap[word]) continue;
      if (seen.has(word)) continue;
      seen.add(word);
      topicWords.push(word.charAt(0).toUpperCase() + word.slice(1));
      if (topicWords.length >= 3) break;
    }

    if (topicWords.length === 0) {
      return `${action} Request`;
    }

    return `${action} ${topicWords.join(' ')}`.trim();
  }

  private isWeakGeneratedTitle(title: string): boolean {
    const normalized = title
      .toLowerCase()
      .replaceAll(/[^a-z0-9\s]/g, ' ')
      .replaceAll(/\s+/g, ' ')
      .trim();

    if (!normalized) return true;
    if (normalized === 'let plan future want') return true;

    const weakTitles = new Set([
      'new conversation',
      'conversation',
      'general request',
      'task request',
      'title request',
      'help request',
    ]);
    if (weakTitles.has(normalized)) return true;

    const words = normalized.split(' ').filter(Boolean);
    if (words.length < 2) return true;

    if (words[0] === 'let' || words[0] === 'lets') return true;

    const noisyWords = new Set(['let', 'lets', 'future', 'want', 'thing', 'things', 'stuff']);
    const contentWords = words.filter((w) => !noisyWords.has(w));
    return contentWords.length === 0;
  }

  /**
   * Add an agent to an existing session (multi-agent mode)
   * @param sessionId - Session ID
   * @param agentId - Agent ID to add
   */
  async addAgentToSession(sessionId: string, agentId: string): Promise<ChatSession> {
    await this.sessions.addSessionAgent(sessionId, agentId);

    // Update lastActivityAt
    await this.sessions.updateSession(sessionId, {
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
      await this.messages.insertMessage(olderSessionId, message);
    }

    // Merge agentIds arrays
    const mergedAgentIds = new Set([...olderSession.agentIds, ...newerSession.agentIds]);

    for (const agentId of mergedAgentIds) {
      await this.sessions.addSessionAgent(olderSessionId, agentId);
    }

    // Track merge history and merge artifacts/files
    const mergedFromSessionIds = [
      ...(olderSession.mergedFromSessionIds || []),
      newerSessionId,
      ...(newerSession.mergedFromSessionIds || []),
    ];

    await this.sessions.updateSession(olderSessionId, {
      lastActivityAt: new Date().toISOString(),
      mergedFromSessionIds,
      artifacts: [...new Set([...olderSession.artifacts, ...newerSession.artifacts])],
      allowedFiles: [...new Set([...olderSession.allowedFiles, ...newerSession.allowedFiles])],
    });

    // Move notes to the surviving session before deleting the merged-away session.
    const newerSessionNotes = await this.notes.listSessionNotes(newerSessionId);
    for (const note of newerSessionNotes) {
      await this.notes.updateNote(note.id, {
        sessionId: olderSessionId,
        sharedSessionIds: (note.sharedSessionIds ?? []).filter(
          (sharedSessionId) => sharedSessionId !== olderSessionId
        ),
      });
    }

    // Delete newer session
    await this.sessions.deleteSession(newerSessionId);

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
    const allSessions = await this.sessions.listSessions(
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

  async getThreadGraphData(sessionId: string): Promise<SessionThreadGraphData> {
    const chain = await this.getSessionChain(sessionId);

    const sessionsWithMessages = await Promise.all(
      chain.map(async (session) => {
        const allMessages = await this.getSessionMessages(session.id);
        const timelineMessages = this.sortMessagesByTimestamp(
          allMessages.filter((message) => this.isTimelineMessage(message))
        );

        return {
          session,
          allMessages,
          timelineMessages,
        };
      })
    );

    const handoffMap = new Map<string, HandoffEdge>();
    for (const entry of sessionsWithMessages) {
      for (const msg of entry.allMessages) {
        if (!msg.handoffId) continue;

        const edge = handoffMap.get(msg.handoffId) ?? {
          handoffId: msg.handoffId,
          fromSessionId: null,
          toSessionId: null,
          fromAgentIds: [],
          toAgentIds: [],
        };

        if (msg.handoffFromSessionId) {
          edge.fromSessionId = msg.handoffFromSessionId;
        }
        if (msg.handoffToSessionId) {
          edge.toSessionId = msg.handoffToSessionId;
        }

        handoffMap.set(msg.handoffId, edge);
      }
    }

    for (const edge of handoffMap.values()) {
      if (edge.fromSessionId) {
        const session = sessionsWithMessages.find(
          (entry) => entry.session.id === edge.fromSessionId
        );
        if (session) {
          edge.fromAgentIds = this.getSessionAgentIds(session.session);
        }
      }

      if (edge.toSessionId) {
        const session = sessionsWithMessages.find((entry) => entry.session.id === edge.toSessionId);
        if (session) {
          edge.toAgentIds = this.getSessionAgentIds(session.session);
        }
      }
    }

    return {
      rootSessionId: sessionsWithMessages[0]?.session.id ?? sessionId,
      depth: sessionsWithMessages.length,
      handoffs: Array.from(handoffMap.values()),
      sessions: sessionsWithMessages.map(({ session, timelineMessages }) => ({
        sessionId: session.id,
        agentIds: this.getSessionAgentIds(session),
        developerId: session.developerId ?? null,
        title: session.title ?? null,
        startedAt: session.startedAt,
        lastActivityAt: session.lastActivityAt,
        previousSessionId: session.previousSessionId ?? null,
        mergedFromSessionIds: session.mergedFromSessionIds ?? null,
        messageCount: timelineMessages.length,
        messages: timelineMessages,
      })),
    };
  }

  private isTimelineMessage(message: ChatMessage): boolean {
    return !message.handoffId && !message.handoffType;
  }

  private sortMessagesByTimestamp(messages: ChatMessage[]): ChatMessage[] {
    return messages
      .map((message, index) => ({
        message,
        index,
        timestampMs: Number.isFinite(Date.parse(message.timestamp))
          ? Date.parse(message.timestamp)
          : 0,
      }))
      .sort((left, right) => left.timestampMs - right.timestampMs || left.index - right.index)
      .map((entry) => entry.message);
  }

  private getSessionAgentIds(session: ChatSession): string[] {
    if (Array.isArray(session.agentIds) && session.agentIds.length > 0) {
      return session.agentIds;
    }

    return session.agentId ? [session.agentId] : [];
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
  async getSessionDeleteImpact(sessionId: string): Promise<SessionDeleteImpact> {
    return this.sessions.getSessionDeleteImpact(sessionId);
  }

  async deleteSession(sessionId: string, options?: SessionDeleteOptions): Promise<void> {
    await this.sessions.deleteSession(sessionId, options);
  }

  // ========== Notes ==========

  async listSessionNotes(sessionId: string): Promise<Note[]> {
    return this.notes.listSessionNotes(sessionId);
  }

  async listDashboardNotes(limit?: number): Promise<Note[]> {
    return this.notes.listDashboardNotes(limit);
  }

  async listAgentNotes(agentId: string): Promise<Note[]> {
    return this.notes.listAgentNotes(agentId);
  }

  async getNote(noteId: string): Promise<Note | null> {
    return this.notes.getNote(noteId);
  }

  async createNote(note: NoteCreateInput): Promise<Note> {
    return this.notes.createNote(note);
  }

  async updateNote(noteId: string, updates: NoteUpdateInput): Promise<Note | null> {
    await this.notes.updateNote(noteId, updates);
    return this.notes.getNote(noteId);
  }

  private normalizeWorkspaceRelativePath(relPath: string): string {
    return relPath.replaceAll('\\', '/');
  }

  private sanitizeFileName(name: string): string {
    return name.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  }

  private createNoteSlug(note: Note): string {
    const base = (note.title || `note-${note.id.slice(0, 8)}`).trim().toLowerCase();
    const slug = base
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, 64);
    return slug || `note-${note.id.slice(0, 8)}`;
  }

  private async moveFileAsync(sourceAbsPath: string, targetAbsPath: string): Promise<void> {
    await fs.mkdir(path.dirname(targetAbsPath), { recursive: true });
    try {
      await fs.rename(sourceAbsPath, targetAbsPath);
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== 'EXDEV') {
        throw error;
      }
    }

    await fs.copyFile(sourceAbsPath, targetAbsPath);
    await fs.rm(sourceAbsPath, { force: true });
  }

  async exportNoteAsMarkdownAsync(
    noteId: string
  ): Promise<{ markdownPath: string; attachmentPath?: string; attachmentPaths?: string[] } | null> {
    const note = await this.notes.getNote(noteId);
    if (!note) return null;

    const exportDirAbs = path.join(this.workspaceRoot, '.ai-team', 'notes');
    const filesDirAbs = path.join(exportDirAbs, 'files');
    await fs.mkdir(exportDirAbs, { recursive: true });

    const slug = this.createNoteSlug(note);
    const noteBaseName = `${slug}-${note.id.slice(0, 8)}`;
    const markdownAbsPath = path.join(exportDirAbs, `${noteBaseName}.md`);

    const attachments = note.attachments ?? (note.attachment ? [note.attachment] : []);
    const updatedAttachments: NoteAttachment[] = [];
    const linkedAttachments: Array<{ attachment: NoteAttachment; markdownLink: string }> = [];

    for (const attachment of attachments) {
      const attachmentRelPath = this.normalizeWorkspaceRelativePath(attachment.filePath);
      const inIgnoredPrivateFolder = attachmentRelPath.startsWith('.ai-team/private/');

      let finalAttachmentRelPath = attachmentRelPath;
      if (inIgnoredPrivateFolder) {
        const sourceAbsPath = path.join(this.workspaceRoot, attachmentRelPath);
        const safeOriginalName = this.sanitizeFileName(attachment.fileName || 'attachment');
        const movedFileName = `${noteBaseName}-${attachment.id}-${safeOriginalName}`;
        const targetAbsPath = path.join(filesDirAbs, movedFileName);

        await this.moveFileAsync(sourceAbsPath, targetAbsPath);

        finalAttachmentRelPath = this.normalizeWorkspaceRelativePath(
          path.relative(this.workspaceRoot, targetAbsPath)
        );
      }

      const updatedAttachment: NoteAttachment = {
        ...attachment,
        filePath: finalAttachmentRelPath,
      };
      updatedAttachments.push(updatedAttachment);
      linkedAttachments.push({
        attachment: updatedAttachment,
        markdownLink: this.normalizeWorkspaceRelativePath(
          path.relative(
            path.dirname(markdownAbsPath),
            path.join(this.workspaceRoot, finalAttachmentRelPath)
          )
        ),
      });
    }

    if (updatedAttachments.length > 0) {
      await this.notes.setNoteAttachmentsAsync(note.id, updatedAttachments);
    }

    const lines: string[] = [];
    lines.push(`# ${note.title?.trim() || `Note ${note.id.slice(0, 8)}`}`);
    lines.push('');
    lines.push(`- **Agent:** ${note.agentId}`);
    if (note.sessionId) {
      lines.push(`- **Session:** ${note.sessionId}`);
    }
    lines.push(`- **Created:** ${note.createdAt}`);
    lines.push(`- **Updated:** ${note.updatedAt}`);
    lines.push('');
    lines.push('## Content');
    lines.push('');
    lines.push(note.content || '');

    if (note.compactedContent) {
      lines.push('');
      lines.push('## Compacted Content');
      lines.push('');
      lines.push(note.compactedContent);
    }

    if (linkedAttachments.length > 0) {
      lines.push('');
      lines.push('## Linked Files');
      lines.push('');
      for (const linkedAttachment of linkedAttachments) {
        lines.push(`- [${linkedAttachment.attachment.fileName}](${linkedAttachment.markdownLink})`);
        if (linkedAttachment.attachment.description) {
          lines.push(`  - ${linkedAttachment.attachment.description}`);
        }
      }
    }

    await fs.writeFile(markdownAbsPath, `${lines.join('\n')}\n`, 'utf-8');

    return {
      markdownPath: this.normalizeWorkspaceRelativePath(
        path.relative(this.workspaceRoot, markdownAbsPath)
      ),
      attachmentPath: updatedAttachments[0]?.filePath,
      attachmentPaths: updatedAttachments.map((attachment) => attachment.filePath),
    };
  }

  private buildSummaryInstructionText(maxWords: number, focusInstruction?: string): string {
    const focus = focusInstruction?.trim();
    const focusSection = focus ? `\nFocus guidance: ${focus}\n` : '';
    return (
      `Produce a compact Markdown summary that is clearly shorter than the source. ` +
      `Write at most ${maxWords} words and avoid repeating source wording verbatim. ` +
      `Keep only key facts, decisions, risks, and action items. ` +
      `Drop examples, repetition, and filler text. ` +
      `Use bullet points only when listing multiple distinct items. ` +
      focusSection
    );
  }

  private getNoteAttachments(note: Note): NoteAttachment[] {
    return note.attachments ?? (note.attachment ? [note.attachment] : []);
  }

  private normalizeSummaryHeading(heading: string): string {
    const normalized = heading.replaceAll(/\r?\n+/g, ' ').trim();
    return normalized.length > 0 ? normalized : 'Summary';
  }

  private buildCompactedSection(
    heading: string,
    body: string,
    link?: { label: string; url: string }
  ): string {
    const normalizedHeading = this.normalizeSummaryHeading(heading);
    const normalizedBody = body.trim();
    const lines = [`[${normalizedHeading}]`];
    if (link) {
      lines.push(`- [${link.label}](${link.url})`);
    }
    lines.push('', normalizedBody);
    return lines.join('\n');
  }

  private async describeImageAttachmentAsync(
    llmService: any,
    note: Note,
    attachment: NoteAttachment,
    maxWords: number,
    focusInstruction?: string
  ): Promise<string> {
    const dataUrl = await this.getAttachmentReader().readAttachmentAsDataUrlAsync(attachment);
    const prompt = [
      `Describe this image in Markdown with at most ${maxWords} words.`,
      'Focus on visible text, structure, layout, diagram relationships, and key signals.',
      note.title ? `Note title: ${note.title}` : null,
      attachment.description ? `Attachment description: ${attachment.description}` : null,
      focusInstruction?.trim() ? `Focus guidance: ${focusInstruction.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    return llmService.rawChat(
      'You describe images for compact note context. Return concise Markdown only.',
      [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        } as any,
      ],
      {
        maxTokens: Math.max(500, maxWords * 6),
      }
    );
  }

  private async summarizeAttachmentAsync(
    llmService: any,
    note: Note,
    attachment: NoteAttachment,
    maxWords: number,
    focusInstruction?: string
  ): Promise<string> {
    if (this.getAttachmentReader().isImageAttachment(attachment)) {
      return this.describeImageAttachmentAsync(
        llmService,
        note,
        attachment,
        maxWords,
        focusInstruction
      );
    }

    const sourceTextPreamble = [
      note.title ? `Note title: ${note.title}` : null,
      `Attachment name: ${attachment.fileName}`,
      attachment.description ? `Attachment description: ${attachment.description}` : null,
      '',
      'Attachment content:',
    ]
      .filter(Boolean)
      .join('\n');

    const attachmentText = await this.getAttachmentReader().extractAttachmentContentAsync(attachment);
    const sourceText = `${sourceTextPreamble}\n${attachmentText}`;

    return this.summarizeHierarchicalAsync(llmService, sourceText, maxWords, focusInstruction);
  }

  private async summarizeTextAsync(
    llmService: any,
    sourceText: string,
    maxWords: number,
    focusInstruction?: string
  ): Promise<string> {
    const fakeAgent = { id: 'system', name: 'System', role: 'system', systemPrompt: '' };
    const prompt =
      `${this.buildSummaryInstructionText(maxWords, focusInstruction)}\n\n` +
      `Source:\n${sourceText}`;
    return llmService.chat(fakeAgent, [{ role: 'user', content: prompt }], {
      maxTokens: Math.max(220, maxWords * 3),
    });
  }

  private async summarizeHierarchicalAsync(
    llmService: any,
    sourceText: string,
    maxWords: number,
    focusInstruction?: string
  ): Promise<string> {
    const chunks = this.getAttachmentReader().splitIntoChunks(sourceText, 5000);

    if (chunks.length <= 1) {
      const summary = await this.summarizeTextAsync(
        llmService,
        sourceText,
        maxWords,
        focusInstruction
      );
      return summary.trim();
    }

    const fakeAgent = { id: 'system', name: 'System', role: 'system', systemPrompt: '' };
    const chunkSummaries: string[] = [];

    for (let index = 0; index < chunks.length; index += 1) {
      const chunkPrompt =
        `Summarize this section (${index + 1}/${chunks.length}) of a larger document. ` +
        `Keep this section summary concise (45-80 words) and strictly shorter than this section. ` +
        `Focus on facts, decisions, and actions.` +
        (focusInstruction?.trim() ? `\nFocus guidance: ${focusInstruction.trim()}\n` : '\n') +
        `\nSection:\n${chunks[index]}`;

      const chunkSummary = await llmService.chat(
        fakeAgent,
        [{ role: 'user', content: chunkPrompt }],
        {
          maxTokens: 420,
        }
      );
      chunkSummaries.push(chunkSummary.trim());
    }

    const finalPrompt =
      `${this.buildSummaryInstructionText(maxWords, focusInstruction)}\n\n` +
      `Combine these section summaries into one final summary:\n` +
      chunkSummaries.map((summary, index) => `\nSection ${index + 1}:\n${summary}`).join('\n');

    const finalSummary = await llmService.chat(
      fakeAgent,
      [{ role: 'user', content: finalPrompt }],
      {
        maxTokens: Math.max(260, maxWords * 3),
      }
    );
    return finalSummary.trim();
  }

  private normalizeWebsiteUrl(url: string): string {
    const candidate = url.trim();
    const withProtocol = /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
    const parsed = new URL(withProtocol);
    parsed.hash = '';
    return parsed.toString();
  }

  private extractHtmlTitle(html: string): string | undefined {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (!titleMatch?.[1]) return undefined;
    return titleMatch[1].replaceAll(/\s+/g, ' ').trim() || undefined;
  }

  private extractHtmlLinks(baseUrl: string, html: string): string[] {
    const links: string[] = [];
    const hrefRegex = /href\s*=\s*["']([^"'#]+)["']/gi;
    let match = hrefRegex.exec(html);

    while (match) {
      const href = match[1]?.trim();
      if (href) {
        try {
          const resolved = new URL(href, baseUrl);
          if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
            resolved.hash = '';
            links.push(resolved.toString());
          }
        } catch {
          // Ignore invalid URLs from page markup.
        }
      }
      match = hrefRegex.exec(html);
    }

    return links;
  }

  private htmlToPlainText(html: string): string {
    return html
      .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replaceAll(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replaceAll(/<[^>]+>/g, ' ')
      .replaceAll(/&nbsp;/gi, ' ')
      .replaceAll(/&amp;/gi, '&')
      .replaceAll(/&lt;/gi, '<')
      .replaceAll(/&gt;/gi, '>')
      .replaceAll(/\s+/g, ' ')
      .trim();
  }

  private async fetchWebsitePageAsync(url: string): Promise<{
    url: string;
    title?: string;
    text: string;
    links: string[];
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'ai-team-note-crawler/1.0',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
        throw new Error(`Unsupported content type for ${url}: ${contentType || 'unknown'}`);
      }

      const raw = await response.text();
      const title = contentType.includes('text/html') ? this.extractHtmlTitle(raw) : undefined;
      const text = contentType.includes('text/html') ? this.htmlToPlainText(raw) : raw.trim();
      const links = contentType.includes('text/html') ? this.extractHtmlLinks(url, raw) : [];

      return {
        url,
        title,
        text: text.slice(0, 24_000),
        links,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async crawlWebsiteAsync(
    startUrl: string,
    maxPages: number
  ): Promise<Array<{ url: string; title?: string; text: string }>> {
    const normalizedStart = this.normalizeWebsiteUrl(startUrl);
    const startOrigin = new URL(normalizedStart).origin;

    const visited = new Set<string>();
    const queued = new Set<string>([normalizedStart]);
    const queue: string[] = [normalizedStart];
    const pages: Array<{ url: string; title?: string; text: string }> = [];

    while (queue.length > 0 && pages.length < maxPages) {
      const currentUrl = queue.shift();
      if (!currentUrl || visited.has(currentUrl)) {
        continue;
      }
      visited.add(currentUrl);

      try {
        const page = await this.fetchWebsitePageAsync(currentUrl);
        if (!page.text) {
          continue;
        }

        pages.push({ url: page.url, title: page.title, text: page.text });

        for (const link of page.links) {
          try {
            const normalizedLink = this.normalizeWebsiteUrl(link);
            if (new URL(normalizedLink).origin !== startOrigin) {
              continue;
            }
            if (visited.has(normalizedLink) || queued.has(normalizedLink)) {
              continue;
            }
            queue.push(normalizedLink);
            queued.add(normalizedLink);
          } catch {
            // Ignore invalid links.
          }
        }
      } catch {
        // Skip failed pages and continue crawling.
      }
    }

    return pages;
  }

  private buildWebsiteSourceText(
    pages: Array<{ url: string; title?: string; text: string }>
  ): string {
    return pages
      .map((page, index) => {
        const heading = page.title ? `${page.title} (${page.url})` : page.url;
        return `Page ${index + 1}: ${heading}\n${page.text}`;
      })
      .join('\n\n');
  }

  private buildWebsiteNotesSection(
    sourceUrl: string,
    pages: Array<{ url: string; title?: string; text: string }>,
    focusInstruction?: string
  ): string {
    const lines = [
      '## Website Crawl Notes',
      '',
      `- **Source URL:** ${sourceUrl}`,
      `- **Crawled at:** ${new Date().toISOString()}`,
      `- **Pages summarized:** ${pages.length}`,
    ];

    if (focusInstruction?.trim()) {
      lines.push(`- **Focus:** ${focusInstruction.trim()}`);
    }

    lines.push('', '### Pages', '');
    lines.push(
      ...pages.map((page) => {
        const title = page.title || page.url;
        return `- [${title}](${page.url})`;
      })
    );

    return `${lines.join('\n')}\n`;
  }

  async summarizeWebsiteNoteAsync(
    noteId: string,
    llmService: any,
    websiteUrl: string,
    maxPages = 5,
    maxWords = 200,
    focusInstruction?: string,
    generateTitle = false
  ): Promise<Note | null> {
    const note = await this.notes.getNote(noteId);
    if (!note) return null;

    const normalizedUrl = this.normalizeWebsiteUrl(websiteUrl);
    const safeMaxPages = Math.max(1, Math.min(20, maxPages));
    const pages = await this.crawlWebsiteAsync(normalizedUrl, safeMaxPages);

    if (pages.length === 0) {
      throw new Error('Could not crawl readable pages from the provided website URL.');
    }

    const sourceText = this.buildWebsiteSourceText(pages);
    const summary = await this.summarizeHierarchicalAsync(
      llmService,
      sourceText,
      maxWords,
      focusInstruction
    );

    const urlSections: string[] = [this.buildCompactedSection('summary of the text', summary)];
    for (const [index, page] of pages.entries()) {
      const pageSummary = await this.summarizeHierarchicalAsync(
        llmService,
        `URL: ${page.url}\nTitle: ${page.title || 'n/a'}\n\n${page.text}`,
        Math.max(80, Math.floor(maxWords / 2)),
        focusInstruction
      );
      urlSections.push(
        this.buildCompactedSection(`url ${index + 1}`, pageSummary, {
          label: page.title || page.url,
          url: page.url,
        })
      );
    }

    const notesSection = this.buildWebsiteNotesSection(normalizedUrl, pages, focusInstruction);
    const existingContent = note.content?.trim();
    const combinedContent = existingContent
      ? `${existingContent}\n\n---\n\n${notesSection}`
      : notesSection;

    await this.notes.updateNote(noteId, {
      content: combinedContent,
      compactedContent: urlSections.join('\n\n').trim(),
    });

    const updatedNote = await this.notes.getNote(noteId);
    if (!updatedNote) {
      return null;
    }

    if (!generateTitle) {
      return updatedNote;
    }

    return this.generateNoteTitleAsync(noteId, llmService, updatedNote, focusInstruction);
  }

  async compactNoteAsync(
    noteId: string,
    llmService: any,
    maxWords = 200,
    focusInstruction?: string,
    generateTitle = false
  ): Promise<Note | null> {
    const note = await this.notes.getNote(noteId);
    if (!note) return null;

    const attachments = this.getNoteAttachments(note);
    const hasAttachment = attachments.length > 0;
    const contentLines = note.content.split('\n').length;
    if (!hasAttachment && contentLines <= 10) {
      if (!generateTitle) {
        return note;
      }

      return this.generateNoteTitleAsync(noteId, llmService, note, focusInstruction);
    }

    try {
      const compactedSections: string[] = [];

      if (note.content.trim()) {
        const titleSection = note.title ? `Title: ${note.title}\n` : '';
        const contentSummary = await this.summarizeHierarchicalAsync(
          llmService,
          `${titleSection}Note content:\n${note.content}`,
          maxWords,
          focusInstruction
        );
        compactedSections.push(this.buildCompactedSection('summary of the text', contentSummary));
      }

      for (const [index, attachment] of attachments.entries()) {
        const summary = await this.summarizeAttachmentAsync(
          llmService,
          note,
          attachment,
          maxWords,
          focusInstruction
        );
        const headingPrefix = this.getAttachmentReader().isImageAttachment(attachment) ? 'image' : 'file';
        const sectionHeading = `${headingPrefix} ${index + 1}`;
        compactedSections.push(
          this.buildCompactedSection(sectionHeading, summary, {
            label: attachment.fileName,
            url: this.normalizeWorkspaceRelativePath(attachment.filePath),
          })
        );
      }

      const compactedContent = compactedSections.join('\n\n');
      await this.notes.updateNote(noteId, { compactedContent: compactedContent.trim() });
      const updatedNote = await this.notes.getNote(noteId);
      if (!updatedNote) {
        return null;
      }

      if (!generateTitle) {
        return updatedNote;
      }

      return this.generateNoteTitleAsync(noteId, llmService, updatedNote, focusInstruction);
    } catch (error) {
      throw error;
    }
  }

  async generateNoteTitleForNoteAsync(
    noteId: string,
    llmService: any,
    focusInstruction?: string
  ): Promise<Note | null> {
    return this.generateNoteTitleAsync(noteId, llmService, undefined, focusInstruction);
  }

  private async generateNoteTitleAsync(
    noteId: string,
    llmService: any,
    existingNote?: Note,
    focusInstruction?: string
  ): Promise<Note | null> {
    const note = existingNote ?? (await this.notes.getNote(noteId));
    if (!note) {
      return null;
    }

    const source = [note.compactedContent?.trim(), note.content?.trim()]
      .filter((value): value is string => Boolean(value && value.length > 0))
      .join('\n\n');

    if (!source) {
      return note;
    }

    try {
      const focus = focusInstruction?.trim();
      const clippedSource = source.slice(0, 8000);

      let generated = '';
      if (typeof llmService.rawChat === 'function') {
        const systemPrompt =
          'You generate concise, specific note titles. Always reason over the user focus instruction first (if provided), then ground the title in the note content. Return only the title.';
        const userPrompt = [
          'Create one short note title (3-8 words).',
          '- Prefer concrete nouns from the note content.',
          '- If a focus instruction is provided, prioritize it.',
          '- Avoid generic titles like "Create Conversation Title".',
          '- No quotes, no punctuation suffix, title only.',
          '',
          `Focus instruction: ${focus && focus.length > 0 ? focus : '(none)'}`,
          '',
          'Note content:',
          clippedSource,
        ].join('\n');

        generated = await llmService.rawChat(
          systemPrompt,
          [{ role: 'user', content: userPrompt }],
          {
            temperature: 0.2,
            maxTokens: 24,
          }
        );
      } else {
        const fallbackPromptParts = [
          focus && focus.length > 0 ? `Focus: ${focus}` : null,
          clippedSource,
        ]
          .filter((value): value is string => Boolean(value))
          .join('\n\n');
        generated = await llmService.generateTitle([
          {
            from: 'human',
            content: fallbackPromptParts,
            timestamp: new Date().toISOString(),
          } as ChatMessage,
        ]);
      }

      const normalized = this.normalizeTitle(generated);
      if (!normalized) {
        return note;
      }

      await this.notes.updateNote(noteId, { title: normalized });
      return this.notes.getNote(noteId);
    } catch (error) {
      console.warn('[SessionManager] Note title generation failed, leaving current title.', error);
      return note;
    }
  }

  async deleteNote(noteId: string): Promise<boolean> {
    return this.notes.deleteNote(noteId);
  }

  // ========== Message ↔ Session Links ==========

  async createMessageSessionLink(
    messageId: number,
    sessionId: string
  ): Promise<MessageSessionLink> {
    return this.messages.createMessageSessionLink(messageId, sessionId);
  }

  async listMessageSessionLinks(sessionId: string): Promise<MessageSessionLink[]> {
    return this.messages.listMessageSessionLinks(sessionId);
  }

  async deleteMessageSessionLink(messageId: number, sessionId: string): Promise<boolean> {
    return this.messages.deleteMessageSessionLink(messageId, sessionId);
  }

  // ========== Session Skills ==========

  async addSessionSkill(sessionId: string, skillPath: string): Promise<void> {
    await this.messages.addSessionSkill(sessionId, skillPath);
  }

  async getSessionSkills(sessionId: string): Promise<SessionSkill[]> {
    return this.messages.getSessionSkills(sessionId);
  }

  async setSessionSkillPaused(
    sessionId: string,
    skillPath: string,
    paused: boolean
  ): Promise<void> {
    await this.messages.setSessionSkillPaused(sessionId, skillPath, paused);
  }

  async updateToolCallLlmResult(toolCallId: number, newText: string): Promise<void> {
    await this.messages.updateToolCallLlmResult(toolCallId, newText);
  }

  async summarizeForContextAsync(
    llmService: any,
    sourceText: string,
    maxWords = 200,
    focusInstruction?: string
  ): Promise<string> {
    return this.summarizeHierarchicalAsync(llmService, sourceText, maxWords, focusInstruction);
  }

  async listNoteSessionSharesAsync(sessionId: string): Promise<NoteSessionShare[]> {
    try {
      return await this.notes.listNoteSessionSharesBySessionAsync(sessionId);
    } catch {
      return [];
    }
  }

  async setNoteAnchorAsync(
    sessionId: string,
    noteId: string,
    anchorMessageId: number,
    kind: NoteSessionShareKind,
    fromMessageId?: number,
    toMessageId?: number
  ): Promise<void> {
    await this.notes.updateNoteSessionShareAsync(noteId, sessionId, {
      anchorMessageId,
      kind,
      active: true,
      fromMessageId: fromMessageId ?? null,
      toMessageId: toMessageId ?? null,
    });
  }

  async deactivateNoteShareAsync(sessionId: string, noteId: string): Promise<void> {
    await this.notes.updateNoteSessionShareAsync(noteId, sessionId, { active: false });
  }
}
