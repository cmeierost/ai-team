import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  Artifact,
  ChatMessage,
  ChatSession,
  type IAgentManager,
  type IMessagesRepository,
  type ISessionManager,
  type ISessionsRepository,
  type ITitleGenerator,
  type MessageSessionLink,
  type SessionDeleteImpact,
  type SessionDeleteOptions,
  type SessionSkill,
} from '@ai-team/core';

export class SessionManager implements ISessionManager {
  private readonly artifactsDir: string;
  private autoTitleLlmService?: any;

  private artifactsDirReady = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly messages: IMessagesRepository,
    private readonly sessions: ISessionsRepository,
    private readonly agentManager: IAgentManager,
    private readonly titleGenerator: ITitleGenerator
  ) {
    this.artifactsDir = path.join(this.workspaceRoot, '.ai-team', 'artifacts', 'briefs');
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

  // ── Session CRUD ───────────────────────────────────────────────────────────

  async createSession(agentQuery: string, developerId: string): Promise<ChatSession> {
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
      agentIds: [agentId],
      agentId,
      developerId,
      startedAt: now,
      lastActivityAt: now,
      artifacts: [],
      allowedFiles: [],
    });

    return session;
  }

  async createHandoffSession(
    toAgentQuery: string,
    developerId: string,
    previousSessionId: string,
    transferArtifacts: boolean = true,
    transferAllowedFiles: boolean = true
  ): Promise<ChatSession> {
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
      agentIds: [toAgentId],
      agentId: toAgentId,
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

  async listRecentSessions(limit = 10, developerId?: string): Promise<ChatSession[]> {
    try {
      return await this.sessions.listSessions({
        developerId,
        sortBy: 'lastActivityAt',
        sortOrder: 'desc',
        limit,
      });
    } catch (error) {
      console.error('Failed to list recent sessions:', error);
      return [];
    }
  }

  async resolveLatestSessionForResume(developerId?: string): Promise<ChatSession | null> {
    const scopedRecent = developerId
      ? await this.listRecentSessions(1, developerId)
      : await this.listRecentSessions(1);

    if (scopedRecent.length > 0) {
      return scopedRecent[0];
    }

    const globalRecent = await this.listRecentSessions(1);
    return globalRecent.length > 0 ? globalRecent[0] : null;
  }

  async listSessions(agentQuery: string, limit?: number): Promise<ChatSession[]> {
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

  async getSession(sessionId: string): Promise<ChatSession | null> {
    try {
      return await this.sessions.getSession(sessionId);
    } catch {
      return null;
    }
  }

  async saveSession(session: ChatSession): Promise<void> {
    await this.sessions.updateSession(session.id, session);
  }

  async getOrCreateLatestSession(agentId: string, developerId: string): Promise<ChatSession> {
    const latest = await this.getLatestSession(agentId);

    if (latest?.developerId === developerId) {
      return latest;
    }

    return await this.createSession(agentId, developerId);
  }

  async addAgentToSession(sessionId: string, agentId: string): Promise<ChatSession> {
    await this.sessions.addSessionAgent(sessionId, agentId);

    await this.sessions.updateSession(sessionId, {
      lastActivityAt: new Date().toISOString(),
    });

    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return session;
  }

  async getSessionDeleteImpact(sessionId: string): Promise<SessionDeleteImpact> {
    return this.sessions.getSessionDeleteImpact(sessionId);
  }

  async deleteSession(sessionId: string, options?: SessionDeleteOptions): Promise<void> {
    await this.sessions.deleteSession(sessionId, options);
  }

  // ── Message CRUD ───────────────────────────────────────────────────────────

  async getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    try {
      return await this.messages.getSessionMessages(sessionId);
    } catch {
      return [];
    }
  }

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

      const title = await this.titleGenerator.generateTitle(sessionId, effectiveLlmService);
      return title;
    } catch (err) {
      console.error('[SessionManager] Auto-title generation failed:', err);
      return null;
    }
  }

  async appendToolCallRequest(sessionId: string, message: ChatMessage): Promise<void> {
    await this.messages.insertToolCallRequest(sessionId, message);
  }

  async appendToolCallResult(
    sessionId: string,
    callId: string,
    result: unknown,
    resultLlm: string | undefined,
    phase: 'result' | 'error' | 'denied',
    timestamp: string
  ): Promise<void> {
    await this.messages.insertToolCallResult(
      sessionId,
      callId,
      result,
      resultLlm,
      phase,
      timestamp
    );
  }

  async deleteSessionMessage(sessionId: string, messageTimestamp: string): Promise<boolean> {
    return this.messages.deleteMessage(sessionId, messageTimestamp);
  }

  async updateToolCallLlmResult(toolCallId: number, newText: string): Promise<void> {
    await this.messages.updateToolCallLlmResult(toolCallId, newText);
  }

  // ── Message ↔ Session Links ────────────────────────────────────────────────

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

  // ── Session Skills ─────────────────────────────────────────────────────────

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

  // ── Artifacts ──────────────────────────────────────────────────────────────

  async createArtifact(
    sessionId: string,
    fromIndex: number,
    toIndex: number,
    summary: string,
    title: string,
    developerId: string
  ): Promise<Artifact> {
    await this.ensureArtifactsDir();

    const session = await this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    const artifactId = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 50);

    const timestamp = Date.now();
    const filename = `${artifactId}-${timestamp}.md`;
    const filepath = path.join(this.artifactsDir, filename);

    const content = `# ${title}\n\n**Created:** ${new Date().toISOString()}\n**Session:** ${sessionId}\n**Created by:** ${developerId}\n**Messages:** ${fromIndex} - ${toIndex}\n\n---\n\n${summary}\n`;

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

    if (!session.artifacts.includes(artifactId)) {
      session.artifacts.push(artifactId);
      await this.saveSession(session);
    }

    return artifact;
  }

  async listArtifacts(): Promise<Artifact[]> {
    try {
      await this.ensureArtifactsDir();
      const files = await fs.readdir(this.artifactsDir);
      const mdFiles = files.filter((f) => f.endsWith('.md'));

      const artifacts: Artifact[] = [];
      for (const file of mdFiles) {
        const filepath = path.join(this.artifactsDir, file);
        const content = await fs.readFile(filepath, 'utf-8');

        const titleMatch = /^# (.+)$/m.exec(content);
        const createdMatch = /\*\*Created:\*\* (.+)$/m.exec(content);
        const sessionMatch = /\*\*Session:\*\* (.+)$/m.exec(content);
        const createdByMatch = /\*\*Created by:\*\* (.+)$/m.exec(content);
        const messagesMatch = /\*\*Messages:\*\* (\d+) - (\d+)$/m.exec(content);

        if (titleMatch && createdMatch && sessionMatch && createdByMatch && messagesMatch) {
          const summaryContent = content.split('---\n')[1]?.trim() || '';
          artifacts.push({
            id: file.slice(0, file.lastIndexOf('-')) || file.replace(/\.md$/, ''),
            type: 'brief',
            title: titleMatch[1],
            content: summaryContent,
            createdAt: createdMatch[1],
            createdBy: createdByMatch[1],
            sourceSessionId: sessionMatch[1],
            fromMessageIndex: Number.parseInt(messagesMatch[1], 10),
            toMessageIndex: Number.parseInt(messagesMatch[2], 10),
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

  async getArtifact(artifactId: string): Promise<Artifact | null> {
    const artifacts = await this.listArtifacts();
    return artifacts.find((a) => a.id === artifactId) || null;
  }
}
