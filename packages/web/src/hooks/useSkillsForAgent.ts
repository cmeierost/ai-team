import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE } from '../context/TeamContext';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

export interface SkillEntry {
  name: string;
  assignedToAgent?: boolean;
  description?: string;
}

function getErrorMessage(error: unknown, fallback: string): string | null {
  if (error instanceof Error) {
    return error.message;
  }

  return error ? fallback : null;
}

async function fetchSkills(agentId: string): Promise<SkillEntry[]> {
  const response = await fetch(`${API_BASE}/api/skills?agent=${encodeURIComponent(agentId)}`);
  if (!response.ok) {
    throw new Error(`Failed to load skills: ${response.statusText}`);
  }

  const data = await response.json();
  const entries = Array.isArray(data.entries) ? data.entries : [];

  return entries
    .map((entry: any) => ({
      name: entry.name,
      assignedToAgent: entry.assignedToAgent,
      description: entry.description,
    }))
    .sort((a: SkillEntry, b: SkillEntry) => a.name.localeCompare(b.name));
}

async function toggleSkillAssignment(agentId: string, skillName: string, currentlyAssigned: boolean): Promise<void> {
  const endpoint = currentlyAssigned ? 'remove' : 'add';
  const response = await fetch(`${API_BASE}/api/skills/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agent: agentId, skill: skillName }),
  });

  if (!response.ok) {
    throw new Error(`Failed to ${currentlyAssigned ? 'remove' : 'add'} skill`);
  }
}

export function useSkillsForAgent(agentId: string) {
  const queryClient = useQueryClient();

  const skillsQuery = useQuery({
    queryKey: contextPanelQueryKeys.skills(agentId),
    queryFn: () => fetchSkills(agentId),
    enabled: Boolean(agentId),
  });

  const toggleSkillMutation = useMutation({
    mutationFn: ({ skillName, currentlyAssigned }: { skillName: string; currentlyAssigned: boolean }) =>
      toggleSkillAssignment(agentId, skillName, currentlyAssigned),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: contextPanelQueryKeys.skills(agentId) });
    },
  });

  return {
    skillEntries: skillsQuery.data ?? [],
    skillsLoading: skillsQuery.isLoading,
    skillsError:
      getErrorMessage(skillsQuery.error, 'Failed to load skills') ??
      getErrorMessage(toggleSkillMutation.error, 'Failed to update skill assignment'),
    skillActionPending: toggleSkillMutation.isPending ? (toggleSkillMutation.variables?.skillName ?? null) : null,
    toggleSkill: (skillName: string, currentlyAssigned: boolean) =>
      toggleSkillMutation.mutateAsync({ skillName, currentlyAssigned }),
  };
}