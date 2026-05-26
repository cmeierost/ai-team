import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';
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

async function fetchSkills(agentId: string, client: ReturnType<typeof useTeam>['client']): Promise<SkillEntry[]> {
  const data = await client.skills.search({ agent: agentId }) as { entries?: any[] };
  const entries = Array.isArray(data.entries) ? data.entries : [];
  return entries
    .map((entry: any) => ({
      name: entry.name,
      assignedToAgent: entry.assignedToAgent,
      description: entry.description,
    }))
    .sort((a: SkillEntry, b: SkillEntry) => a.name.localeCompare(b.name));
}

async function toggleSkillAssignment(
  agentId: string,
  skillName: string,
  currentlyAssigned: boolean,
  client: ReturnType<typeof useTeam>['client'],
): Promise<void> {
  if (currentlyAssigned) {
    await client.skills.remove({ agent: agentId, skill: skillName });
  } else {
    await client.skills.add({ agent: agentId, skill: skillName });
  }
}

export function useSkillsForAgent(agentId: string) {
  const { client } = useTeam();
  const queryClient = useQueryClient();

  const skillsQuery = useQuery({
    queryKey: contextPanelQueryKeys.skills(agentId),
    queryFn: () => fetchSkills(agentId, client),
    enabled: Boolean(agentId),
  });

  const toggleSkillMutation = useMutation({
    mutationFn: ({ skillName, currentlyAssigned }: { skillName: string; currentlyAssigned: boolean }) =>
      toggleSkillAssignment(agentId, skillName, currentlyAssigned, client),
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