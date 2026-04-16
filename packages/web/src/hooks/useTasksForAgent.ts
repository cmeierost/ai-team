import { useQuery } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';
import type { Task } from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

export function useTasksForAgent(agentId: string) {
  const { client } = useTeam();
  return useQuery({
    queryKey: contextPanelQueryKeys.tasks(agentId),
    queryFn: () => client.tasks.list({ assignedTo: agentId }) as Promise<Task[]>,
    enabled: Boolean(agentId),
  });
}