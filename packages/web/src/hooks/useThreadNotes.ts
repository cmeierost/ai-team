import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';
import { buildThreadContextNotes, type ContextPanelNoteItem } from '../utils/contextPanel';
import type { Note, SessionThread } from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

function getErrorMessage(error: unknown, fallback: string): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  return error ? fallback : null;
}

export function useThreadNotes(sessionId?: string) {
  const { client } = useTeam();
  const queryClient = useQueryClient();

  const notesQuery = useQuery({
    queryKey: sessionId
      ? contextPanelQueryKeys.threadNotes(sessionId)
      : ['context-panel', 'thread-notes', 'idle'],
    queryFn: async () => {
      const thread = (await client.sessions.getThread(sessionId!)) as SessionThread;
      const notesBySessionEntries = await Promise.all(
        thread.sessions.map(async (session) => {
          const notes = (await client.sessions.listNotes(session.sessionId)) as Note[];
          return [session.sessionId, notes] as const;
        })
      );

      return buildThreadContextNotes(thread, Object.fromEntries(notesBySessionEntries), sessionId!);
    },
    enabled: Boolean(sessionId),
  });

  const shareNoteMutation = useMutation({
    mutationFn: async (noteItem: ContextPanelNoteItem) => {
      if (!sessionId || !noteItem.canPullIntoCurrentSession) {
        return noteItem.note;
      }

      const nextSharedSessionIds = Array.from(
        new Set([...(noteItem.note.sharedSessionIds ?? []), sessionId])
      );

      return (await client.sessions.updateNote(noteItem.ownerSession.sessionId, noteItem.note.id, {
        sharedSessionIds: nextSharedSessionIds,
      })) as Note;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['context-panel', 'notes'] }),
        sessionId
          ? queryClient.invalidateQueries({
              queryKey: contextPanelQueryKeys.threadNotes(sessionId),
            })
          : Promise.resolve(),
      ]);
    },
  });

  return {
    notes: notesQuery.data ?? [],
    notesLoading: notesQuery.isLoading,
    notesError:
      getErrorMessage(notesQuery.error, 'Failed to load thread notes') ??
      getErrorMessage(shareNoteMutation.error, 'Failed to share note with this session'),
    shareNoteToSession: shareNoteMutation.mutateAsync,
    sharingNoteId: shareNoteMutation.variables?.note.id ?? null,
    sharingNote: shareNoteMutation.isPending,
  };
}
