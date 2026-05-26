import { useQuery } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';
import type { ChatSession } from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

export function useRecentSessions(limit = 10) {
  const { client } = useTeam();
  const recentSessionsQuery = useQuery({
    queryKey: contextPanelQueryKeys.recentSessions(limit),
    queryFn: async () => {
      const sessions = await client.sessions.recent({ limit }) as ChatSession[];
      return [...sessions].sort((left, right) => {
        const rightTime = new Date(right.lastActivityAt).getTime();
        const leftTime = new Date(left.lastActivityAt).getTime();
        return rightTime - leftTime;
      });
    },
  });

  return {
    recentSessions: recentSessionsQuery.data ?? [],
    recentSessionsLoading: recentSessionsQuery.isLoading,
    recentSessionsError: recentSessionsQuery.error,
  };
}