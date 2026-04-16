import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';
import type { ChatSession, SessionDeleteImpact } from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

function getErrorMessage(error: unknown, fallback: string): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  return error ? fallback : null;
}

export function useSessionsForAgent(agentId: string) {
  const { client } = useTeam();
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: contextPanelQueryKeys.sessions(agentId),
    queryFn: () => client.sessions.list({ agentId, limit: 20 }) as Promise<ChatSession[]>,
    enabled: Boolean(agentId),
  });

  const saveNotesMutation = useMutation({
    mutationFn: ({ sessionId, notes }: { sessionId: string; notes: string }) =>
      client.sessions.update(sessionId, { notes }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessions(agentId) });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: ({
      sessionId,
      deleteUnsharedOwnedNotes,
    }: {
      sessionId: string;
      deleteUnsharedOwnedNotes?: boolean;
    }) =>
      deleteUnsharedOwnedNotes
        ? client.sessions.deleteWithOptions(sessionId, { deleteUnsharedOwnedNotes: true })
        : client.sessions.delete(sessionId),
    onSuccess: async (_, variables) => {
      queryClient.setQueriesData<ChatSession[]>({ queryKey: contextPanelQueryKeys.sessions(agentId) }, (old) =>
        old?.filter((session) => session.id !== variables.sessionId) ?? [],
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessions(agentId) }),
        queryClient.invalidateQueries({ queryKey: ['context-panel', 'notes'] }),
        queryClient.invalidateQueries({ queryKey: ['context-panel', 'thread-notes'] }),
      ]);
    },
  });

  return {
    sessions: sessionsQuery.data ?? [],
    sessionsLoading: sessionsQuery.isLoading,
    sessionsError:
      getErrorMessage(sessionsQuery.error, 'Failed to load sessions') ??
      getErrorMessage(saveNotesMutation.error, 'Failed to save notes') ??
      getErrorMessage(deleteSessionMutation.error, 'Failed to delete session'),
    getDeleteImpact: (sessionId: string) =>
      client.sessions.getDeleteImpact(sessionId) as Promise<SessionDeleteImpact>,
    saveNotes: (sessionId: string, notes: string) => saveNotesMutation.mutateAsync({ sessionId, notes }),
    savingNotes: saveNotesMutation.isPending,
    notesError: getErrorMessage(saveNotesMutation.error, 'Failed to save notes'),
    deleteSession: (sessionId: string, options?: { deleteUnsharedOwnedNotes?: boolean }) =>
      deleteSessionMutation.mutateAsync({
        sessionId,
        deleteUnsharedOwnedNotes: options?.deleteUnsharedOwnedNotes,
      }),
  };
}