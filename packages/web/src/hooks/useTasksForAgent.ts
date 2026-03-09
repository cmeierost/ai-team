import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '../context/TeamContext';
import type { Task } from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

async function fetchTasks(agentId: string): Promise<Task[]> {
  const response = await fetch(`${API_BASE}/api/tasks?assignedTo=${encodeURIComponent(agentId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load tasks: ${response.statusText}`);
  }

  return (await response.json()) as Task[];
}

export function useTasksForAgent(agentId: string) {
  return useQuery({
    queryKey: contextPanelQueryKeys.tasks(agentId),
    queryFn: () => fetchTasks(agentId),
    enabled: Boolean(agentId),
  });
}