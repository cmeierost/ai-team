import type {
  Note,
  NoteAttachment,
  NoteAttachmentInput,
  NoteAttachmentUpdateInput,
  NoteCreateInput,
  NoteSessionShare,
  NoteSessionShareUpdateInput,
  NoteUpdateInput,
  RetainedNoteAttachmentInput,
  INotesRepository,
} from '@ai-team/core';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { SqliteDrizzleDatabase } from '../storage/sqlite/connection.js';
import * as dbSchema from '../storage/sqlite/schema.js';
import * as fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

type EnsureReadyAsync = () => Promise<void>;
type GetDb = () => SqliteDrizzleDatabase;

export class NotesRepository implements INotesRepository {
  private readonly noteAttachmentsDir: string;

  constructor(
    private readonly workspaceRoot: string,
    private readonly ensureReadyAsync: EnsureReadyAsync,
    private readonly getDb: GetDb
  ) {
    this.noteAttachmentsDir = path.join(workspaceRoot, '.ai-team', 'private', 'note-attachments');
  }

  private db() {
    return this.getDb();
  }

  private async ensureNoteAttachmentsDir(): Promise<void> {
    await fs.mkdir(this.noteAttachmentsDir, { recursive: true });
  }

  private sanitizeAttachmentName(fileName: string): string {
    const base = path.basename(fileName || 'attachment');
    return base.replaceAll(/[^a-zA-Z0-9._-]/g, '-');
  }

  private async writeAttachmentAsync(
    noteId: string,
    attachment: NoteAttachmentInput,
    attachmentId: string
  ): Promise<NoteAttachment> {
    await this.ensureNoteAttachmentsDir();
    const safeName = this.sanitizeAttachmentName(attachment.fileName);
    const storedName = `${noteId}-${attachmentId}-${safeName}`;
    const absolutePath = path.join(this.noteAttachmentsDir, storedName);
    const buffer = Buffer.from(attachment.contentBase64, 'base64');
    await fs.writeFile(absolutePath, buffer);
    return {
      id: attachmentId,
      fileName: attachment.fileName,
      filePath: path.relative(this.workspaceRoot, absolutePath),
      contentType: attachment.contentType || undefined,
      sizeBytes: attachment.sizeBytes ?? buffer.byteLength,
      description: attachment.description || undefined,
    };
  }

  private toLegacyAttachment(row: any): NoteAttachment | undefined {
    if (!row.attachment_path) {
      return undefined;
    }

    return {
      id: `${row.id}-legacy-0`,
      fileName: row.attachment_name,
      filePath: row.attachment_path,
      contentType: row.attachment_content_type || undefined,
      sizeBytes: row.attachment_size_bytes || 0,
      description: row.attachment_description || undefined,
    };
  }

  private async deleteAttachmentFilesAsync(attachments: NoteAttachment[]): Promise<void> {
    await Promise.all(
      attachments
        .filter((attachment) => attachment.filePath)
        .map(async (attachment) => {
          const absolutePath = path.join(this.workspaceRoot, attachment.filePath);
          await fs.rm(absolutePath, { force: true });
        })
    );
  }

  async deleteAttachmentsIfPresentAsync(note: Note | null): Promise<void> {
    const attachments = note?.attachments ?? (note?.attachment ? [note.attachment] : []);
    if (attachments.length === 0) {
      return;
    }

    await this.deleteAttachmentFilesAsync(attachments);
  }

  private async listNoteAttachmentsByNoteIdsAsync(
    noteIds: string[]
  ): Promise<Map<string, NoteAttachment[]>> {
    const byNoteId = new Map<string, NoteAttachment[]>();
    if (noteIds.length === 0) {
      return byNoteId;
    }

    const rows = await this.db()
      .select({
        id: dbSchema.noteAttachments.id,
        noteId: dbSchema.noteAttachments.noteId,
        fileName: dbSchema.noteAttachments.fileName,
        filePath: dbSchema.noteAttachments.filePath,
        contentType: dbSchema.noteAttachments.contentType,
        sizeBytes: dbSchema.noteAttachments.sizeBytes,
        description: dbSchema.noteAttachments.description,
        sortOrder: dbSchema.noteAttachments.sortOrder,
        createdAt: dbSchema.noteAttachments.createdAt,
      })
      .from(dbSchema.noteAttachments)
      .where(inArray(dbSchema.noteAttachments.noteId, noteIds))
      .orderBy(
        asc(dbSchema.noteAttachments.noteId),
        asc(dbSchema.noteAttachments.sortOrder),
        asc(dbSchema.noteAttachments.createdAt)
      );

    for (const row of rows) {
      const attachment: NoteAttachment = {
        id: row.id,
        fileName: row.fileName,
        filePath: row.filePath,
        contentType: row.contentType || undefined,
        sizeBytes: row.sizeBytes,
        description: row.description || undefined,
      };

      const existing = byNoteId.get(row.noteId);
      if (existing) {
        existing.push(attachment);
      } else {
        byNoteId.set(row.noteId, [attachment]);
      }
    }

    return byNoteId;
  }

  private async listSharedSessionIdsByNoteIdsAsync(
    noteIds: string[]
  ): Promise<Map<string, string[]>> {
    const byNoteId = new Map<string, string[]>();
    if (noteIds.length === 0) {
      return byNoteId;
    }

    const rows = await this.db()
      .select({
        noteId: dbSchema.noteSessionShares.noteId,
        sessionId: dbSchema.noteSessionShares.sessionId,
      })
      .from(dbSchema.noteSessionShares)
      .where(inArray(dbSchema.noteSessionShares.noteId, noteIds))
      .orderBy(asc(dbSchema.noteSessionShares.createdAt));

    for (const row of rows) {
      const existing = byNoteId.get(row.noteId);
      if (existing) {
        existing.push(row.sessionId);
      } else {
        byNoteId.set(row.noteId, [row.sessionId]);
      }
    }

    return byNoteId;
  }

  private isRetainedNoteAttachmentInput(
    input: NoteAttachmentUpdateInput
  ): input is RetainedNoteAttachmentInput {
    return 'id' in input && !('contentBase64' in input);
  }

  private async resolveUpdatedAttachmentsAsync(
    noteId: string,
    existingAttachments: NoteAttachment[],
    requestedAttachments: NoteAttachmentUpdateInput[] | null
  ): Promise<NoteAttachment[]> {
    if (requestedAttachments === null) {
      return [];
    }

    const existingById = new Map(
      existingAttachments.map((attachment) => [attachment.id, attachment])
    );
    const nextAttachments: NoteAttachment[] = [];

    for (const requestedAttachment of requestedAttachments) {
      if (this.isRetainedNoteAttachmentInput(requestedAttachment)) {
        const existing = existingById.get(requestedAttachment.id);
        if (!existing) {
          throw new Error(`Cannot retain missing attachment "${requestedAttachment.id}".`);
        }
        nextAttachments.push(existing);
        continue;
      }

      const attachmentId = randomBytes(8).toString('hex');
      const storedAttachment = await this.writeAttachmentAsync(
        noteId,
        requestedAttachment,
        attachmentId
      );
      nextAttachments.push(storedAttachment);
    }

    return nextAttachments;
  }

  private rowToNote(row: any, attachments: NoteAttachment[] = []): Note {
    const normalizedAttachments =
      attachments.length > 0
        ? attachments
        : (() => {
            const legacyAttachment = this.toLegacyAttachment(row);
            return legacyAttachment ? [legacyAttachment] : [];
          })();

    let sharedSessionIds: string[] | undefined;
    if (Array.isArray(row.sharedSessionIds)) {
      sharedSessionIds = row.sharedSessionIds as string[];
    } else if (row.shared_session_ids) {
      sharedSessionIds = (row.shared_session_ids as string).split(',').filter(Boolean);
    }

    return {
      id: row.id,
      agentId: row.agent_id,
      sessionId: row.session_id || undefined,
      sharedSessionIds,
      title: row.title || undefined,
      content: row.content,
      compactedContent: row.compacted_content || undefined,
      hiddenFromLlm: row.hidden_from_llm === 1,
      showOnDashboard: row.show_on_dashboard === 1,
      tags: row.tags_json ? JSON.parse(row.tags_json) : undefined,
      attachments: normalizedAttachments.length > 0 ? normalizedAttachments : undefined,
      attachment: normalizedAttachments[0],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private getCurrentAttachments(note: Note): NoteAttachment[] {
    return note.attachments ?? (note.attachment ? [note.attachment] : []);
  }

  private getRequestedAttachments(
    updates: NoteUpdateInput
  ): NoteAttachmentUpdateInput[] | null | undefined {
    if (updates.attachments !== undefined) {
      return updates.attachments;
    }

    if (updates.attachment === undefined) {
      return undefined;
    }

    return updates.attachment ? [updates.attachment] : null;
  }

  private applyScalarNoteUpdates(
    updates: NoteUpdateInput,
    noteUpdates: Record<string, unknown>
  ): boolean {
    let hasNoteFieldUpdates = false;

    if (updates.title !== undefined) {
      noteUpdates.title = updates.title || null;
      hasNoteFieldUpdates = true;
    }

    if (updates.content !== undefined) {
      noteUpdates.content = updates.content;
      hasNoteFieldUpdates = true;
    }

    if (updates.sessionId !== undefined) {
      noteUpdates.sessionId = updates.sessionId || null;
      hasNoteFieldUpdates = true;
    }

    if (updates.tags !== undefined) {
      noteUpdates.tagsJson = updates.tags ? JSON.stringify(updates.tags) : null;
      hasNoteFieldUpdates = true;
    }

    if (updates.compactedContent !== undefined) {
      noteUpdates.compactedContent = updates.compactedContent ?? null;
      hasNoteFieldUpdates = true;
    }

    if (updates.hiddenFromLlm !== undefined) {
      noteUpdates.hiddenFromLlm = updates.hiddenFromLlm ? 1 : 0;
      hasNoteFieldUpdates = true;
    }

    if (updates.showOnDashboard !== undefined) {
      noteUpdates.showOnDashboard = updates.showOnDashboard ? 1 : 0;
      hasNoteFieldUpdates = true;
    }

    return hasNoteFieldUpdates;
  }

  private async applyAttachmentUpdatesAsync(
    noteId: string,
    currentAttachments: NoteAttachment[],
    requestedAttachments: NoteAttachmentUpdateInput[] | null,
    noteUpdates: Record<string, unknown>
  ): Promise<NoteAttachment[]> {
    const nextAttachments = await this.resolveUpdatedAttachmentsAsync(
      noteId,
      currentAttachments,
      requestedAttachments
    );

    const retainedAttachmentIds = new Set(nextAttachments.map((attachment) => attachment.id));
    const removedAttachments = currentAttachments.filter(
      (attachment) => !retainedAttachmentIds.has(attachment.id)
    );
    await this.deleteAttachmentFilesAsync(removedAttachments);

    const firstAttachment = nextAttachments[0];
    noteUpdates.attachmentName = firstAttachment?.fileName || null;
    noteUpdates.attachmentPath = firstAttachment?.filePath || null;
    noteUpdates.attachmentContentType = firstAttachment?.contentType || null;
    noteUpdates.attachmentSizeBytes = firstAttachment?.sizeBytes || null;
    noteUpdates.attachmentDescription = firstAttachment?.description || null;

    return nextAttachments;
  }

  private async updateSharedSessionIdsAsync(
    noteId: string,
    sharedSessionIds: string[] | null | undefined
  ): Promise<void> {
    await this.db()
      .delete(dbSchema.noteSessionShares)
      .where(eq(dbSchema.noteSessionShares.noteId, noteId));

    if (!sharedSessionIds || sharedSessionIds.length === 0) {
      return;
    }

    const sharesNow = new Date().toISOString();
    for (const sessionId of sharedSessionIds) {
      this.db()
        .insert(dbSchema.noteSessionShares)
        .values({ noteId, sessionId, createdAt: sharesNow })
        .onConflictDoNothing()
        .run();
    }
  }

  async createNote(note: NoteCreateInput): Promise<Note> {
    await this.ensureReadyAsync();
    const id = randomBytes(8).toString('hex');
    const now = new Date().toISOString();
    const tagsJson = note.tags ? JSON.stringify(note.tags) : null;
    const requestedAttachments = note.attachments ?? (note.attachment ? [note.attachment] : []);
    const storedAttachments = await Promise.all(
      requestedAttachments.map(async (attachment) => {
        const attachmentId = randomBytes(8).toString('hex');
        return this.writeAttachmentAsync(id, attachment, attachmentId);
      })
    );
    const firstAttachment = storedAttachments[0];

    this.db().transaction((tx) => {
      tx.insert(dbSchema.notes)
        .values({
          id,
          agentId: note.agentId,
          sessionId: note.sessionId || null,
          title: note.title || null,
          content: note.content ?? '',
          tagsJson,
          attachmentName: firstAttachment?.fileName || null,
          attachmentPath: firstAttachment?.filePath || null,
          attachmentContentType: firstAttachment?.contentType || null,
          attachmentSizeBytes: firstAttachment?.sizeBytes || null,
          attachmentDescription: firstAttachment?.description || null,
          compactedContent: null,
          hiddenFromLlm: note.hiddenFromLlm ? 1 : 0,
          showOnDashboard: note.showOnDashboard ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const [index, attachment] of storedAttachments.entries()) {
        tx.insert(dbSchema.noteAttachments)
          .values({
            id: attachment.id,
            noteId: id,
            fileName: attachment.fileName,
            filePath: attachment.filePath,
            contentType: attachment.contentType || null,
            sizeBytes: attachment.sizeBytes,
            description: attachment.description || null,
            sortOrder: index,
            createdAt: now,
          })
          .run();
      }

      if (note.sharedSessionIds && note.sharedSessionIds.length > 0) {
        for (const sharedSessionId of note.sharedSessionIds) {
          tx.insert(dbSchema.noteSessionShares)
            .values({ noteId: id, sessionId: sharedSessionId, createdAt: now })
            .onConflictDoNothing()
            .run();
        }
      }
    });

    return {
      id,
      agentId: note.agentId,
      sessionId: note.sessionId,
      sharedSessionIds: note.sharedSessionIds,
      title: note.title,
      content: note.content ?? '',
      hiddenFromLlm: note.hiddenFromLlm ?? false,
      showOnDashboard: note.showOnDashboard ?? false,
      tags: note.tags,
      attachments: storedAttachments.length > 0 ? storedAttachments : undefined,
      attachment: firstAttachment,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getNote(noteId: string): Promise<Note | null> {
    await this.ensureReadyAsync();
    const row = await this.db()
      .select({
        id: dbSchema.notes.id,
        agent_id: dbSchema.notes.agentId,
        session_id: dbSchema.notes.sessionId,
        title: dbSchema.notes.title,
        content: dbSchema.notes.content,
        tags_json: dbSchema.notes.tagsJson,
        attachment_name: dbSchema.notes.attachmentName,
        attachment_path: dbSchema.notes.attachmentPath,
        attachment_content_type: dbSchema.notes.attachmentContentType,
        attachment_size_bytes: dbSchema.notes.attachmentSizeBytes,
        attachment_description: dbSchema.notes.attachmentDescription,
        compacted_content: dbSchema.notes.compactedContent,
        hidden_from_llm: dbSchema.notes.hiddenFromLlm,
        show_on_dashboard: dbSchema.notes.showOnDashboard,
        created_at: dbSchema.notes.createdAt,
        updated_at: dbSchema.notes.updatedAt,
      })
      .from(dbSchema.notes)
      .where(eq(dbSchema.notes.id, noteId))
      .get();

    if (!row) {
      return null;
    }

    const attachmentsByNoteId = await this.listNoteAttachmentsByNoteIdsAsync([noteId]);
    const sharesByNoteId = await this.listSharedSessionIdsByNoteIdsAsync([noteId]);
    return this.rowToNote(
      {
        ...row,
        sharedSessionIds: sharesByNoteId.get(noteId) ?? [],
      },
      attachmentsByNoteId.get(noteId) ?? []
    );
  }

  async listSessionNotes(sessionId: string): Promise<Note[]> {
    await this.ensureReadyAsync();
    const rows = await this.db()
      .select({
        id: dbSchema.notes.id,
        agent_id: dbSchema.notes.agentId,
        session_id: dbSchema.notes.sessionId,
        title: dbSchema.notes.title,
        content: dbSchema.notes.content,
        tags_json: dbSchema.notes.tagsJson,
        attachment_name: dbSchema.notes.attachmentName,
        attachment_path: dbSchema.notes.attachmentPath,
        attachment_content_type: dbSchema.notes.attachmentContentType,
        attachment_size_bytes: dbSchema.notes.attachmentSizeBytes,
        attachment_description: dbSchema.notes.attachmentDescription,
        compacted_content: dbSchema.notes.compactedContent,
        hidden_from_llm: dbSchema.notes.hiddenFromLlm,
        show_on_dashboard: dbSchema.notes.showOnDashboard,
        created_at: dbSchema.notes.createdAt,
        updated_at: dbSchema.notes.updatedAt,
      })
      .from(dbSchema.notes)
      .where(eq(dbSchema.notes.sessionId, sessionId))
      .orderBy(desc(dbSchema.notes.updatedAt));

    const attachmentsByNoteId = await this.listNoteAttachmentsByNoteIdsAsync(
      rows.map((row: any) => row.id as string)
    );
    const sharesByNoteId = await this.listSharedSessionIdsByNoteIdsAsync(
      rows.map((row: any) => row.id as string)
    );

    return rows.map((row: any) =>
      this.rowToNote(
        {
          ...row,
          sharedSessionIds: sharesByNoteId.get(row.id) ?? [],
        },
        attachmentsByNoteId.get(row.id) ?? []
      )
    );
  }

  async listAgentNotes(agentId: string): Promise<Note[]> {
    await this.ensureReadyAsync();
    const rows = await this.db()
      .select({
        id: dbSchema.notes.id,
        agent_id: dbSchema.notes.agentId,
        session_id: dbSchema.notes.sessionId,
        title: dbSchema.notes.title,
        content: dbSchema.notes.content,
        tags_json: dbSchema.notes.tagsJson,
        attachment_name: dbSchema.notes.attachmentName,
        attachment_path: dbSchema.notes.attachmentPath,
        attachment_content_type: dbSchema.notes.attachmentContentType,
        attachment_size_bytes: dbSchema.notes.attachmentSizeBytes,
        attachment_description: dbSchema.notes.attachmentDescription,
        compacted_content: dbSchema.notes.compactedContent,
        hidden_from_llm: dbSchema.notes.hiddenFromLlm,
        show_on_dashboard: dbSchema.notes.showOnDashboard,
        created_at: dbSchema.notes.createdAt,
        updated_at: dbSchema.notes.updatedAt,
      })
      .from(dbSchema.notes)
      .where(eq(dbSchema.notes.agentId, agentId))
      .orderBy(desc(dbSchema.notes.createdAt));

    const attachmentsByNoteId = await this.listNoteAttachmentsByNoteIdsAsync(
      rows.map((row: any) => row.id as string)
    );
    const sharesByNoteId = await this.listSharedSessionIdsByNoteIdsAsync(
      rows.map((row: any) => row.id as string)
    );

    return rows.map((row: any) =>
      this.rowToNote(
        {
          ...row,
          sharedSessionIds: sharesByNoteId.get(row.id) ?? [],
        },
        attachmentsByNoteId.get(row.id) ?? []
      )
    );
  }

  async listDashboardNotes(limit?: number): Promise<Note[]> {
    await this.ensureReadyAsync();
    let query: any = this.db()
      .select({
        id: dbSchema.notes.id,
        agent_id: dbSchema.notes.agentId,
        session_id: dbSchema.notes.sessionId,
        title: dbSchema.notes.title,
        content: dbSchema.notes.content,
        tags_json: dbSchema.notes.tagsJson,
        attachment_name: dbSchema.notes.attachmentName,
        attachment_path: dbSchema.notes.attachmentPath,
        attachment_content_type: dbSchema.notes.attachmentContentType,
        attachment_size_bytes: dbSchema.notes.attachmentSizeBytes,
        attachment_description: dbSchema.notes.attachmentDescription,
        compacted_content: dbSchema.notes.compactedContent,
        hidden_from_llm: dbSchema.notes.hiddenFromLlm,
        show_on_dashboard: dbSchema.notes.showOnDashboard,
        created_at: dbSchema.notes.createdAt,
        updated_at: dbSchema.notes.updatedAt,
      })
      .from(dbSchema.notes)
      .where(eq(dbSchema.notes.showOnDashboard, 1))
      .orderBy(desc(dbSchema.notes.updatedAt));

    if (limit && limit > 0) {
      query = query.limit(Math.floor(limit));
    }

    const rows = await query;

    const attachmentsByNoteId = await this.listNoteAttachmentsByNoteIdsAsync(
      rows.map((row: any) => row.id as string)
    );
    const sharesByNoteId = await this.listSharedSessionIdsByNoteIdsAsync(
      rows.map((row: any) => row.id as string)
    );

    return rows.map((row: any) =>
      this.rowToNote(
        {
          ...row,
          sharedSessionIds: sharesByNoteId.get(row.id) ?? [],
        },
        attachmentsByNoteId.get(row.id) ?? []
      )
    );
  }

  async updateNote(noteId: string, updates: NoteUpdateInput): Promise<void> {
    await this.ensureReadyAsync();
    const existing = await this.getNote(noteId);
    if (!existing) {
      return;
    }

    const now = new Date().toISOString();
    const noteUpdates: Record<string, unknown> = {};
    let hasNoteFieldUpdates = this.applyScalarNoteUpdates(updates, noteUpdates);
    const currentAttachments = this.getCurrentAttachments(existing);
    const requestedAttachments = this.getRequestedAttachments(updates);
    let nextAttachments: NoteAttachment[] | undefined;

    if (requestedAttachments !== undefined) {
      nextAttachments = await this.applyAttachmentUpdatesAsync(
        noteId,
        currentAttachments,
        requestedAttachments,
        noteUpdates
      );
      hasNoteFieldUpdates = true;
    }

    if (!hasNoteFieldUpdates && updates.sharedSessionIds === undefined) {
      return; // No updates
    }
    noteUpdates.updatedAt = now;

    if (hasNoteFieldUpdates) {
      await this.db().update(dbSchema.notes).set(noteUpdates).where(eq(dbSchema.notes.id, noteId));
    }

    if (nextAttachments !== undefined) {
      await this.setNoteAttachmentsAsync(noteId, nextAttachments);
    }

    if (updates.sharedSessionIds !== undefined) {
      await this.updateSharedSessionIdsAsync(noteId, updates.sharedSessionIds);
    }
  }

  async setNoteAttachmentsAsync(noteId: string, attachments: NoteAttachment[]): Promise<void> {
    await this.ensureReadyAsync();
    const now = new Date().toISOString();
    const firstAttachment = attachments[0];
    this.db().transaction((tx) => {
      tx.update(dbSchema.notes)
        .set({
          attachmentName: firstAttachment?.fileName ?? null,
          attachmentPath: firstAttachment?.filePath ?? null,
          attachmentContentType: firstAttachment?.contentType ?? null,
          attachmentSizeBytes: firstAttachment?.sizeBytes ?? null,
          attachmentDescription: firstAttachment?.description ?? null,
          updatedAt: now,
        })
        .where(eq(dbSchema.notes.id, noteId))
        .run();

      tx.delete(dbSchema.noteAttachments).where(eq(dbSchema.noteAttachments.noteId, noteId)).run();

      for (const [index, attachment] of attachments.entries()) {
        tx.insert(dbSchema.noteAttachments)
          .values({
            id: attachment.id,
            noteId,
            fileName: attachment.fileName,
            filePath: attachment.filePath,
            contentType: attachment.contentType ?? null,
            sizeBytes: attachment.sizeBytes,
            description: attachment.description ?? null,
            sortOrder: index,
            createdAt: now,
          })
          .run();
      }
    });
  }

  async deleteNote(noteId: string): Promise<boolean> {
    await this.ensureReadyAsync();
    const existing = await this.getNote(noteId);
    const result = this.db().delete(dbSchema.notes).where(eq(dbSchema.notes.id, noteId)).run();
    if ((result.changes || 0) > 0) {
      await this.deleteAttachmentsIfPresentAsync(existing);
    }
    return (result.changes || 0) > 0;
  }

  async searchNotes(query: string, agentId?: string): Promise<Note[]> {
    await this.ensureReadyAsync();
    const conditions = [sql`notes_fts MATCH ${query}`];
    if (agentId) {
      conditions.push(sql`notes_fts.agent_id = ${agentId}`);
    }

    const rows = this.db().all<any>(sql`
      SELECT
        n.id,
        n.agent_id,
        n.title,
        n.content,
        n.tags_json,
        n.session_id,
        n.attachment_name,
        n.attachment_path,
        n.attachment_content_type,
        n.attachment_size_bytes,
        n.attachment_description,
        n.compacted_content,
        n.hidden_from_llm,
        n.show_on_dashboard,
        n.created_at,
        n.updated_at,
        notes_fts.rank
      FROM notes n
      INNER JOIN notes_fts ON notes_fts.note_id = n.id
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY notes_fts.rank, n.created_at DESC
      LIMIT 100
    `);

    const attachmentsByNoteId = await this.listNoteAttachmentsByNoteIdsAsync(
      rows.map((row: any) => row.id as string)
    );
    const sharesByNoteId = await this.listSharedSessionIdsByNoteIdsAsync(
      rows.map((row: any) => row.id as string)
    );

    return rows.map((row: any) =>
      this.rowToNote(
        {
          ...row,
          sharedSessionIds: sharesByNoteId.get(row.id) ?? [],
        },
        attachmentsByNoteId.get(row.id) ?? []
      )
    );
  }

  async listNoteSessionSharesBySessionAsync(sessionId: string): Promise<NoteSessionShare[]> {
    await this.ensureReadyAsync();
    const rows = await this.db()
      .select({
        note_id: dbSchema.noteSessionShares.noteId,
        session_id: dbSchema.noteSessionShares.sessionId,
        anchor_message_id: dbSchema.noteSessionShares.anchorMessageId,
        kind: dbSchema.noteSessionShares.kind,
        active: dbSchema.noteSessionShares.active,
        from_message_id: dbSchema.noteSessionShares.fromMessageId,
        to_message_id: dbSchema.noteSessionShares.toMessageId,
        created_at: dbSchema.noteSessionShares.createdAt,
      })
      .from(dbSchema.noteSessionShares)
      .where(eq(dbSchema.noteSessionShares.sessionId, sessionId))
      .orderBy(
        sql`CASE WHEN ${dbSchema.noteSessionShares.anchorMessageId} IS NULL THEN 1 ELSE 0 END`,
        asc(dbSchema.noteSessionShares.anchorMessageId)
      );

    return rows.map((row) => ({
      noteId: row.note_id as string,
      sessionId: row.session_id as string,
      anchorMessageId:
        row.anchor_message_id === null ? undefined : (row.anchor_message_id as number),
      kind: (row.kind as NoteSessionShare['kind']) ?? undefined,
      active: row.active === 1,
      fromMessageId: row.from_message_id === null ? undefined : (row.from_message_id as number),
      toMessageId: row.to_message_id === null ? undefined : (row.to_message_id as number),
      createdAt: row.created_at as string,
    }));
  }

  async updateNoteSessionShareAsync(
    noteId: string,
    sessionId: string,
    updates: NoteSessionShareUpdateInput
  ): Promise<void> {
    await this.ensureReadyAsync();
    const now = new Date().toISOString();
    // Ensure the share row exists first
    this.db()
      .insert(dbSchema.noteSessionShares)
      .values({ noteId, sessionId, createdAt: now })
      .onConflictDoNothing()
      .run();

    const shareUpdates: Record<string, unknown> = {};
    if ('anchorMessageId' in updates) {
      shareUpdates.anchorMessageId = updates.anchorMessageId ?? null;
    }
    if ('kind' in updates) {
      shareUpdates.kind = updates.kind ?? null;
    }
    if ('active' in updates && updates.active !== undefined) {
      shareUpdates.active = updates.active ? 1 : 0;
    }
    if ('fromMessageId' in updates) {
      shareUpdates.fromMessageId = updates.fromMessageId ?? null;
    }
    if ('toMessageId' in updates) {
      shareUpdates.toMessageId = updates.toMessageId ?? null;
    }
    if (Object.keys(shareUpdates).length === 0) return;

    await this.db()
      .update(dbSchema.noteSessionShares)
      .set(shareUpdates)
      .where(
        and(
          eq(dbSchema.noteSessionShares.noteId, noteId),
          eq(dbSchema.noteSessionShares.sessionId, sessionId)
        )
      );
  }
}
