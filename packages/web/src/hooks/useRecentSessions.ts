import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '../context/TeamContext';
import type { ChatSession } from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

async function fetchRecentSessions(limit: number): Promise<ChatSession[]> {
  const response = await fetch(`${API_BASE}/api/sessions/recent?limit=${encodeURIComponent(String(limit))}`);
  if (!response.ok) {
    throw new Error(`Failed to load recent sessions: ${response.statusText}`);
  }

  const sessions = (await response.json()) as ChatSession[];

  return [...sessions].sort((left, right) => {
    const rightTime = new Date(right.lastActivityAt).getTime();
    const leftTime = new Date(left.lastActivityAt).getTime();

    return rightTime - leftTime;
  });
}

export function useRecentSessions(limit = 10) {
  const recentSessionsQuery = useQuery({
    queryKey: contextPanelQueryKeys.recentSessions(limit),
    queryFn: () => fetchRecentSessions(limit),
  });

  return {
    recentSessions: recentSessionsQuery.data ?? [],
    recentSessionsLoading: recentSessionsQuery.isLoading,
    recentSessionsError: recentSessionsQuery.error,
  };
}