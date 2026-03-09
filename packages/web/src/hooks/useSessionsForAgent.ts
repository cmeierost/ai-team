import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE } from '../context/TeamContext';
import type { ChatSession } from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

function getErrorMessage(error: unknown, fallback: string): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  return error ? fallback : null;
}

async function fetchSessions(agentId: string): Promise<ChatSession[]> {
  const response = await fetch(`${API_BASE}/api/sessions?agentId=${encodeURIComponent(agentId)}&limit=20`);
  if (!response.ok) {
    throw new Error(`Failed to load sessions: ${response.statusText}`);
  }

  return (await response.json()) as ChatSession[];
}

async function saveSessionNotes(sessionId: string, notes: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save notes: ${response.statusText}`);
  }
}

async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`, {
    method: 'DELETE',
  });

  if (!response.ok && response.status !== 204) {
    throw new Error('Failed to delete session');
  }
}

export function useSessionsForAgent(agentId: string) {
  const queryClient = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: contextPanelQueryKeys.sessions(agentId),
    queryFn: () => fetchSessions(agentId),
    enabled: Boolean(agentId),
  });

  const saveNotesMutation = useMutation({
    mutationFn: ({ sessionId, notes }: { sessionId: string; notes: string }) => saveSessionNotes(sessionId, notes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.sessions(agentId) });
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => deleteSession(sessionId),
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