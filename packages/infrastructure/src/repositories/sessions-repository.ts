import type {
  ChatSession,
  SessionFilter,
  SessionDeleteImpact,
  SessionDeleteOptions,
  ISessionsRepository,
} from '@ai-team/core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SqliteDrizzleDatabase } from '../storage/sqlite/connection.js';
import * as dbSchema from '../storage/sqlite/schema.js';
import type { NotesRepository } from './notes-repository.js';

type EnsureReadyAsync = () => Promise<void>;
type GetDb = () => SqliteDrizzleDatabase;

export class SessionsRepository implements ISessionsRepository {
  constructor(
    private readonly ensureReadyAsync: EnsureReadyAsync,
    private readonly getDb: GetDb,
    private readonly notesRepository: NotesRepository
  ) {}

  private db() {
    return this.getDb();
  }

  async createSession(session: Omit<ChatSession, 'id' | 'messageCount'>): Promise<ChatSession> {
    await this.ensureReadyAsync();
    const now = new Date().toISOString();
    const id = session.startedAt
      ? `session-${session.startedAt.split('T')[0]}-${Math.random().toString(36).substring(2, 8)}`
      : `session-${now.split('T')[0]}-${Math.random().toString(36).substring(2, 8)}`;

    this.db().transaction((tx) => {
      tx.insert(dbSchema.sessions)
        .values({
          id,
          developerId: session.developerId,
          startedAt: session.startedAt || now,
          lastActivityAt: session.lastActivityAt || now,
          messageCount: 0,
          title: session.title || null,
          notes: session.notes || null,
          previousSessionId: session.previousSessionId || null,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const agentId of session.agentIds) {
        tx.insert(dbSchema.sessionAgents).values({ sessionId: id, agentId }).run();
      }

      if (session.artifacts && session.artifacts.length > 0) {
        for (const artifact of session.artifacts) {
          tx.insert(dbSchema.sessionArtifacts)
            .values({ sessionId: id, artifactPath: artifact })
            .run();
        }
      }

      if (session.allowedFiles && session.allowedFiles.length > 0) {
        for (const filePath of session.allowedFiles) {
          tx.insert(dbSchema.sessionFiles)
            .values({
              sessionId: id,
              filePath,
              isPrioritized: session.prioritizedFiles?.includes(filePath) ? 1 : 0,
            })
            .run();
        }
      }

      if (session.mergedFromSessionIds && session.mergedFromSessionIds.length > 0) {
        for (const mergedId of session.mergedFromSessionIds) {
          tx.insert(dbSchema.sessionMergedFrom)
            .values({ sessionId: id, mergedSessionId: mergedId })
            .run();
        }
      }

      if (session.ragConfig) {
        tx.insert(dbSchema.sessionRagConfig)
          .values({ sessionId: id, configJson: JSON.stringify(session.ragConfig) })
          .run();
      }
    });

    return {
      id,
      ...session,
      messageCount: 0,
    };
  }

  async getSession(sessionId: string): Promise<ChatSession | null> {
    await this.ensureReadyAsync();
    const row = this.db()
      .select({
        id: dbSchema.sessions.id,
        developer_id: dbSchema.sessions.developerId,
        started_at: dbSchema.sessions.startedAt,
        last_activity_at: dbSchema.sessions.lastActivityAt,
        message_count: dbSchema.sessions.messageCount,
        title: dbSchema.sessions.title,
        notes: dbSchema.sessions.notes,
        previous_session_id: dbSchema.sessions.previousSessionId,
        created_at: dbSchema.sessions.createdAt,
        updated_at: dbSchema.sessions.updatedAt,
      })
      .from(dbSchema.sessions)
      .where(eq(dbSchema.sessions.id, sessionId))
      .get();

    if (!row) {
      return null;
    }

    return this.rowToSession(row);
  }

  async updateSession(
    sessionId: string,
    updates: Partial<Omit<ChatSession, 'id' | 'messageCount'>>
  ): Promise<void> {
    await this.ensureReadyAsync();
    const now = new Date().toISOString();
    const sessionUpdates: Record<string, unknown> = {};

    if (updates.title !== undefined) {
      sessionUpdates.title = updates.title;
    }

    if (updates.notes !== undefined) {
      sessionUpdates.notes = updates.notes;
    }

    if (updates.lastActivityAt) {
      sessionUpdates.lastActivityAt = updates.lastActivityAt;
    }

    if (updates.previousSessionId !== undefined) {
      sessionUpdates.previousSessionId = updates.previousSessionId;
    }

    sessionUpdates.updatedAt = now;

    const hasAdditionalUpdates =
      updates.artifacts !== undefined ||
      updates.allowedFiles !== undefined ||
      updates.prioritizedFiles !== undefined ||
      updates.ragConfig !== undefined ||
      updates.mergedFromSessionIds !== undefined;

    if (Object.keys(sessionUpdates).length === 1 && !hasAdditionalUpdates) {
      return;
    }

    this.db().transaction((tx) => {
      if (Object.keys(sessionUpdates).length > 1) {
        tx.update(dbSchema.sessions)
          .set(sessionUpdates)
          .where(eq(dbSchema.sessions.id, sessionId))
          .run();
      }

      if (updates.artifacts !== undefined) {
        tx.delete(dbSchema.sessionArtifacts)
          .where(eq(dbSchema.sessionArtifacts.sessionId, sessionId))
          .run();
        for (const artifact of updates.artifacts) {
          tx.insert(dbSchema.sessionArtifacts).values({ sessionId, artifactPath: artifact }).run();
        }
      }

      if (updates.allowedFiles !== undefined || updates.prioritizedFiles !== undefined) {
        tx.delete(dbSchema.sessionFiles)
          .where(eq(dbSchema.sessionFiles.sessionId, sessionId))
          .run();
        const allowedFiles = updates.allowedFiles || [];
        const prioritizedFiles = updates.prioritizedFiles || [];
        for (const filePath of allowedFiles) {
          tx.insert(dbSchema.sessionFiles)
            .values({
              sessionId,
              filePath,
              isPrioritized: prioritizedFiles.includes(filePath) ? 1 : 0,
            })
            .run();
        }
      }

      if (updates.ragConfig !== undefined) {
        tx.delete(dbSchema.sessionRagConfig)
          .where(eq(dbSchema.sessionRagConfig.sessionId, sessionId))
          .run();
        if (updates.ragConfig) {
          tx.insert(dbSchema.sessionRagConfig)
            .values({ sessionId, configJson: JSON.stringify(updates.ragConfig) })
            .run();
        }
      }

      if (updates.mergedFromSessionIds !== undefined) {
        tx.delete(dbSchema.sessionMergedFrom)
          .where(eq(dbSchema.sessionMergedFrom.sessionId, sessionId))
          .run();
        for (const mergedId of updates.mergedFromSessionIds) {
          tx.insert(dbSchema.sessionMergedFrom)
            .values({ sessionId, mergedSessionId: mergedId })
            .run();
        }
      }
    });
  }

  async listSessions(filter?: SessionFilter): Promise<ChatSession[]> {
    await this.ensureReadyAsync();
    const conditions: Array<ReturnType<typeof eq> | ReturnType<typeof sql>> = [];

    if (filter?.developerId) {
      conditions.push(eq(dbSchema.sessions.developerId, filter.developerId));
    }

    if (filter?.agentId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM session_agents sa WHERE sa.session_id = ${dbSchema.sessions.id} AND sa.agent_id = ${filter.agentId})`
      );
    }

    if (filter?.hasAgents && filter.hasAgents.length > 0) {
      for (const agentId of filter.hasAgents) {
        conditions.push(
          sql`EXISTS (SELECT 1 FROM session_agents sa WHERE sa.session_id = ${dbSchema.sessions.id} AND sa.agent_id = ${agentId})`
        );
      }
    }

    if (filter?.timestampFrom) {
      conditions.push(sql`${dbSchema.sessions.startedAt} >= ${filter.timestampFrom}`);
    }

    if (filter?.timestampTo) {
      conditions.push(sql`${dbSchema.sessions.startedAt} <= ${filter.timestampTo}`);
    }

    const sortBy = filter?.sortBy || 'lastActivityAt';
    const sortOrder = filter?.sortOrder || 'desc';
    let orderByColumn: any = dbSchema.sessions.lastActivityAt;
    if (sortBy === 'startedAt') {
      orderByColumn = dbSchema.sessions.startedAt;
    } else if (sortBy === 'messageCount') {
      orderByColumn = dbSchema.sessions.messageCount;
    }

    let query: any = this.db()
      .select({
        id: dbSchema.sessions.id,
        developer_id: dbSchema.sessions.developerId,
        started_at: dbSchema.sessions.startedAt,
        last_activity_at: dbSchema.sessions.lastActivityAt,
        message_count: dbSchema.sessions.messageCount,
        title: dbSchema.sessions.title,
        notes: dbSchema.sessions.notes,
        previous_session_id: dbSchema.sessions.previousSessionId,
        created_at: dbSchema.sessions.createdAt,
        updated_at: dbSchema.sessions.updatedAt,
      })
      .from(dbSchema.sessions);

    if (conditions.length > 0) {
      query = query.where(and(...conditions));
    }

    query = query.orderBy(sortOrder === 'asc' ? asc(orderByColumn) : desc(orderByColumn));
    if (filter?.limit) query = query.limit(filter.limit);
    if (filter?.offset) query = query.offset(filter.offset);

    const rows = await query;

    const sessions: ChatSession[] = [];
    for (const row of rows) {
      const session = await this.rowToSession(row);
      sessions.push(session);
    }

    return sessions;
  }

  async addSessionAgent(sessionId: string, agentId: string): Promise<void> {
    await this.ensureReadyAsync();
    this.db()
      .insert(dbSchema.sessionAgents)
      .values({ sessionId, agentId })
      .onConflictDoNothing()
      .run();
  }

  async removeSessionAgent(sessionId: string, agentId: string): Promise<void> {
    await this.ensureReadyAsync();
    this.db()
      .delete(dbSchema.sessionAgents)
      .where(
        and(
          eq(dbSchema.sessionAgents.sessionId, sessionId),
          eq(dbSchema.sessionAgents.agentId, agentId)
        )
      )
      .run();
  }

  async getSessionDeleteImpact(sessionId: string): Promise<SessionDeleteImpact> {
    await this.ensureReadyAsync();

    const ownedNotes = await this.notesRepository.listSessionNotes(sessionId);
    const sharesByNote = new Map<string, string[]>();
    if (ownedNotes.length > 0) {
      const noteIds = ownedNotes.map((note) => note.id);
      const shareRows = await this.db()
        .select({
          note_id: dbSchema.noteSessionShares.noteId,
          session_id: dbSchema.noteSessionShares.sessionId,
        })
        .from(dbSchema.noteSessionShares)
        .where(inArray(dbSchema.noteSessionShares.noteId, noteIds))
        .orderBy(asc(dbSchema.noteSessionShares.createdAt));

      for (const row of shareRows) {
        const existing = sharesByNote.get(row.note_id);
        if (existing) {
          existing.push(row.session_id);
        } else {
          sharesByNote.set(row.note_id, [row.session_id]);
        }
      }
    }

    const sharedSessionCandidates = Array.from(
      new Set(
        ownedNotes.flatMap((note) =>
          (sharesByNote.get(note.id) ?? []).filter(
            (sharedSessionId) => sharedSessionId !== sessionId
          )
        )
      )
    );

    const existingSharedSessions = new Set<string>();
    if (sharedSessionCandidates.length > 0) {
      const rows = await this.db()
        .select({ id: dbSchema.sessions.id })
        .from(dbSchema.sessions)
        .where(inArray(dbSchema.sessions.id, sharedSessionCandidates));

      for (const row of rows) {
        existingSharedSessions.add(row.id);
      }
    }

    const transferableNotes: SessionDeleteImpact['transferableNotes'] = [];
    const unsharedOwnedNotes: SessionDeleteImpact['unsharedOwnedNotes'] = [];

    for (const note of ownedNotes) {
      const survivingSharedSessionIds = (sharesByNote.get(note.id) ?? []).filter(
        (sharedSessionId) => existingSharedSessions.has(sharedSessionId)
      );
      const [targetSessionId, ...remainingSharedSessionIds] = survivingSharedSessionIds;
      if (targetSessionId) {
        transferableNotes.push({
          noteId: note.id,
          title: note.title,
          targetSessionId,
          remainingSharedSessionIds,
        });
      } else {
        unsharedOwnedNotes.push({
          noteId: note.id,
          title: note.title,
        });
      }
    }

    return {
      sessionId,
      transferableNotes,
      unsharedOwnedNotes,
    };
  }

  async deleteSession(sessionId: string, options?: SessionDeleteOptions): Promise<boolean> {
    await this.ensureReadyAsync();
    const impact = await this.getSessionDeleteImpact(sessionId);
    if (impact.unsharedOwnedNotes.length > 0 && !options?.deleteUnsharedOwnedNotes) {
      throw new Error(
        `Cannot delete session ${sessionId} because it owns ${impact.unsharedOwnedNotes.length} unshared note(s).`
      );
    }

    const existingSession = await this.getSession(sessionId);
    if (!existingSession) {
      return false;
    }

    const ownedNotes = await this.notesRepository.listSessionNotes(sessionId);
    const noteById = new Map(ownedNotes.map((note) => [note.id, note]));
    const deletedNotes = impact.unsharedOwnedNotes
      .map((entry) => noteById.get(entry.noteId) ?? null)
      .filter((note): note is NonNullable<typeof note> => note !== null);
    const now = new Date().toISOString();

    this.db().transaction((tx) => {
      for (const transfer of impact.transferableNotes) {
        tx.update(dbSchema.notes)
          .set({ sessionId: transfer.targetSessionId, updatedAt: now })
          .where(eq(dbSchema.notes.id, transfer.noteId))
          .run();

        tx.delete(dbSchema.noteSessionShares)
          .where(eq(dbSchema.noteSessionShares.noteId, transfer.noteId))
          .run();

        for (const sharedSessionId of transfer.remainingSharedSessionIds) {
          tx.insert(dbSchema.noteSessionShares)
            .values({ noteId: transfer.noteId, sessionId: sharedSessionId, createdAt: now })
            .onConflictDoNothing()
            .run();
        }
      }

      if (options?.deleteUnsharedOwnedNotes) {
        for (const blockedNote of impact.unsharedOwnedNotes) {
          tx.delete(dbSchema.notes).where(eq(dbSchema.notes.id, blockedNote.noteId)).run();
        }
      }

      tx.update(dbSchema.sessions)
        .set({ previousSessionId: null })
        .where(eq(dbSchema.sessions.previousSessionId, sessionId))
        .run();

      tx.update(dbSchema.messages)
        .set({ handoffFromSessionId: null })
        .where(eq(dbSchema.messages.handoffFromSessionId, sessionId))
        .run();

      tx.update(dbSchema.messages)
        .set({ handoffToSessionId: null })
        .where(eq(dbSchema.messages.handoffToSessionId, sessionId))
        .run();

      tx.delete(dbSchema.sessions).where(eq(dbSchema.sessions.id, sessionId)).run();
    });

    for (const note of deletedNotes) {
      await this.notesRepository.deleteAttachmentsIfPresentAsync(note);
    }

    return true;
  }

  private async rowToSession(row: any): Promise<ChatSession> {
    const sessionId = row.id;

    const agentRows = await this.db()
      .select({ agent_id: dbSchema.sessionAgents.agentId })
      .from(dbSchema.sessionAgents)
      .where(eq(dbSchema.sessionAgents.sessionId, sessionId));
    const agentIds = agentRows.map((record) => record.agent_id);

    const artifactRows = await this.db()
      .select({ artifact_path: dbSchema.sessionArtifacts.artifactPath })
      .from(dbSchema.sessionArtifacts)
      .where(eq(dbSchema.sessionArtifacts.sessionId, sessionId));
    const artifacts = artifactRows.map((record) => record.artifact_path);

    const fileRows = await this.db()
      .select({
        file_path: dbSchema.sessionFiles.filePath,
        is_prioritized: dbSchema.sessionFiles.isPrioritized,
      })
      .from(dbSchema.sessionFiles)
      .where(eq(dbSchema.sessionFiles.sessionId, sessionId));

    const allowedFiles = fileRows.map((record) => record.file_path);
    const prioritizedFiles = fileRows
      .filter((record) => record.is_prioritized === 1)
      .map((record) => record.file_path);

    const mergedRows = await this.db()
      .select({ merged_session_id: dbSchema.sessionMergedFrom.mergedSessionId })
      .from(dbSchema.sessionMergedFrom)
      .where(eq(dbSchema.sessionMergedFrom.sessionId, sessionId));
    const mergedFromSessionIds = mergedRows.map((record) => record.merged_session_id);

    const ragRow = this.db()
      .select({ config_json: dbSchema.sessionRagConfig.configJson })
      .from(dbSchema.sessionRagConfig)
      .where(eq(dbSchema.sessionRagConfig.sessionId, sessionId))
      .get();
    const ragConfig = ragRow ? JSON.parse(ragRow.config_json) : undefined;

    return {
      id: sessionId,
      agentIds,
      agentId: agentIds[0] || '', // Backward compatibility
      developerId: row.developer_id,
      startedAt: row.started_at,
      lastActivityAt: row.last_activity_at,
      messageCount: row.message_count,
      title: row.title || undefined,
      artifacts,
      allowedFiles,
      prioritizedFiles: prioritizedFiles.length > 0 ? prioritizedFiles : undefined,
      notes: row.notes || undefined,
      ragConfig,
      previousSessionId: row.previous_session_id || undefined,
      mergedFromSessionIds: mergedFromSessionIds.length > 0 ? mergedFromSessionIds : undefined,
    };
  }
}
