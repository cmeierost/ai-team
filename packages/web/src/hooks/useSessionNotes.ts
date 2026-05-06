import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTeam, API_BASE } from '../context/TeamContext';
import type { Note, NoteAttachmentInput, NoteAttachmentUpdateInput } from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';
import { summarizeNoteViaWebSocket } from '@ai-team/api-contracts';

interface NoteMarkdownExportResult {
  markdownPath: string;
  attachmentPath?: string;
  attachmentPaths?: string[];
}

function getErrorMessage(error: unknown, fallback: string): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  return error ? fallback : null;
}

export function useSessionNotes(sessionId?: string, agentId?: string) {
  const { client } = useTeam();
  const queryClient = useQueryClient();

  const notesQuery = useQuery({
    queryKey: sessionId
      ? contextPanelQueryKeys.notes(sessionId)
      : ['context-panel', 'notes', 'idle'],
    queryFn: () => client.sessions.listNotes(sessionId!) as Promise<Note[]>,
    enabled: Boolean(sessionId),
  });

  const invalidateNotesAsync = async () => {
    if (!sessionId) {
      return;
    }
    await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.notes(sessionId) });
  };

  const invalidateContextEstimateAsync = async () => {
    if (!sessionId || !agentId) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: contextPanelQueryKeys.contextEstimate(agentId, sessionId),
    });
  };

  const createNoteMutation = useMutation({
    mutationFn: (input: {
      sessionId: string;
      agentId: string;
      sharedSessionIds?: string[];
      title?: string;
      content?: string;
      hiddenFromLlm?: boolean;
      showOnDashboard?: boolean;
      attachments?: NoteAttachmentInput[];
      attachment?: NoteAttachmentInput;
    }) => {
      const body: Record<string, unknown> = {
        agentId: input.agentId,
        sharedSessionIds: input.sharedSessionIds,
        title: input.title,
        content: input.content,
        hiddenFromLlm: input.hiddenFromLlm,
        showOnDashboard: input.showOnDashboard,
        attachment: input.attachment,
      };

      if (input.attachments) {
        body.attachments = input.attachments;
      }

      return client.sessions.createNote(input.sessionId, body as any) as Promise<Note>;
    },
    onSuccess: async () => {
      await invalidateNotesAsync();
      await invalidateContextEstimateAsync();
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: (input: {
      sessionId: string;
      noteId: string;
      title?: string;
      content?: string;
      compactedContent?: string | null;
      sharedSessionIds?: string[] | null;
      hiddenFromLlm?: boolean;
      showOnDashboard?: boolean;
      attachments?: NoteAttachmentUpdateInput[] | null;
      attachment?: NoteAttachmentInput | null;
    }) => {
      const body: Record<string, unknown> = {
        title: input.title,
        content: input.content,
        compactedContent: input.compactedContent,
        sharedSessionIds: input.sharedSessionIds,
        hiddenFromLlm: input.hiddenFromLlm,
        showOnDashboard: input.showOnDashboard,
        attachment: input.attachment,
      };

      if (input.attachments !== undefined) {
        body.attachments = input.attachments;
      }

      return client.sessions.updateNote(
        input.sessionId,
        input.noteId,
        body as any
      ) as Promise<Note>;
    },
    onSuccess: async () => {
      await invalidateNotesAsync();
      await invalidateContextEstimateAsync();
    },
  });

  const compactNoteMutation = useMutation({
    mutationFn: async ({
      sessionId: sid,
      noteId,
      maxWords,
      focusInstruction,
      generateTitle,
      onStatus,
    }: {
      sessionId: string;
      noteId: string;
      maxWords?: number;
      focusInstruction?: string;
      generateTitle?: boolean;
      onStatus?: (status: string) => void;
    }): Promise<Note> => {
      const effectiveAgentId = agentId ?? 'default';
      let lastNote: Note | null = null;
      for await (const event of summarizeNoteViaWebSocket(effectiveAgentId, {
        url: API_BASE,
        sessionId: sid,
        noteId,
        operation: 'compact',
        maxWords,
        focusInstruction,
        generateTitle,
        onStatus,
      })) {
        if (event.kind === 'done') {
          lastNote = (event as any).result as Note;
        }
      }
      if (!lastNote) {
        throw new Error('Compact summarize did not return a note');
      }
      return lastNote;
    },
    onSuccess: async () => {
      await invalidateNotesAsync();
      await invalidateContextEstimateAsync();
    },
  });

  const crawlSummarizeWebsiteMutation = useMutation({
    mutationFn: async ({
      sessionId: sid,
      noteId,
      websiteUrl,
      maxPages,
      maxWords,
      focusInstruction,
      generateTitle,
      onStatus,
    }: {
      sessionId: string;
      noteId: string;
      websiteUrl: string;
      maxPages?: number;
      maxWords?: number;
      focusInstruction?: string;
      generateTitle?: boolean;
      onStatus?: (status: string) => void;
    }): Promise<Note> => {
      const effectiveAgentId = agentId ?? 'default';
      let lastNote: Note | null = null;
      for await (const event of summarizeNoteViaWebSocket(effectiveAgentId, {
        url: API_BASE,
        sessionId: sid,
        noteId,
        operation: 'crawl',
        websiteUrl,
        maxPages,
        maxWords,
        focusInstruction,
        generateTitle,
        onStatus,
      })) {
        if (event.kind === 'done') {
          lastNote = (event as any).result as Note;
        }
      }
      if (!lastNote) {
        throw new Error('Crawl summarize did not return a note');
      }
      return lastNote;
    },
    onSuccess: async () => {
      await invalidateNotesAsync();
      await invalidateContextEstimateAsync();
    },
  });

  const saveCompactedContentMutation = useMutation({
    mutationFn: (input: { sessionId: string; noteId: string; compactedContent: string | null }) =>
      client.sessions.updateNote(input.sessionId, input.noteId, {
        compactedContent: input.compactedContent,
      }) as Promise<Note>,
    onSuccess: async () => {
      await invalidateNotesAsync();
      await invalidateContextEstimateAsync();
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: ({ sessionId, noteId }: { sessionId: string; noteId: string }) =>
      client.sessions.deleteNote(sessionId, noteId),
    onSuccess: async () => {
      await invalidateNotesAsync();
      await invalidateContextEstimateAsync();
    },
  });

  const exportNoteMarkdownMutation = useMutation({
    mutationFn: ({ sessionId, noteId }: { sessionId: string; noteId: string }) =>
      client.sessions.exportNoteMarkdown(sessionId, noteId) as Promise<NoteMarkdownExportResult>,
    onSuccess: async () => {
      await invalidateNotesAsync();
    },
  });

  return {
    notes: notesQuery.data ?? [],
    notesLoading: notesQuery.isLoading,
    notesError:
      getErrorMessage(notesQuery.error, 'Failed to load notes') ??
      getErrorMessage(createNoteMutation.error, 'Failed to create note') ??
      getErrorMessage(updateNoteMutation.error, 'Failed to update note') ??
      getErrorMessage(compactNoteMutation.error, 'Failed to compact note') ??
      getErrorMessage(crawlSummarizeWebsiteMutation.error, 'Failed to summarize website') ??
      getErrorMessage(saveCompactedContentMutation.error, 'Failed to save compacted note') ??
      getErrorMessage(exportNoteMarkdownMutation.error, 'Failed to export note markdown') ??
      getErrorMessage(deleteNoteMutation.error, 'Failed to delete note'),
    createNote: createNoteMutation.mutateAsync,
    updateNote: updateNoteMutation.mutateAsync,
    compactNote: compactNoteMutation.mutateAsync,
    crawlSummarizeWebsite: crawlSummarizeWebsiteMutation.mutateAsync,
    saveCompactedContent: saveCompactedContentMutation.mutateAsync,
    exportNoteMarkdown: exportNoteMarkdownMutation.mutateAsync,
    deleteNote: deleteNoteMutation.mutateAsync,
    creatingNote: createNoteMutation.isPending,
    updatingNote: updateNoteMutation.isPending,
    compactingNote: compactNoteMutation.isPending,
    crawlSummarizingWebsite: crawlSummarizeWebsiteMutation.isPending,
    savingCompactedContent: saveCompactedContentMutation.isPending,
    exportingNoteMarkdown: exportNoteMarkdownMutation.isPending,
    deletingNote: deleteNoteMutation.isPending,
  };
}
