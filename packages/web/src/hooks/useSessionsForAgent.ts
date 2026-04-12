import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';
import type { ChatSession } from '../types';
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
    mutationFn: (sessionId: string) => client.sessions.delete(sessionId),
    onSuccess: async (_, deletedSessionId) => {
      queryClient.setQueriesData<ChatSession[]>({ queryKey: contextPanelQueryKeys.sessions(agentId) }, (old) =>
        old?.filter((session) => session.id !== deletedSessionId) ?? [],
      );
      await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessions(agentId) });
    },
  });

  return {
    sessions: sessionsQuery.data ?? [],
    sessionsLoading: sessionsQuery.isLoading,
    sessionsError:
      getErrorMessage(sessionsQuery.error, 'Failed to load sessions') ??
      getErrorMessage(saveNotesMutation.error, 'Failed to save notes') ??
      getErrorMessage(deleteSessionMutation.error, 'Failed to delete session'),
    saveNotes: (sessionId: string, notes: string) => saveNotesMutation.mutateAsync({ sessionId, notes }),
    savingNotes: saveNotesMutation.isPending,
    notesError: getErrorMessage(saveNotesMutation.error, 'Failed to save notes'),
    deleteSession: (sessionId: string) => deleteSessionMutation.mutateAsync(sessionId),
  };
}