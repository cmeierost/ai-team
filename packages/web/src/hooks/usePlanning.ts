import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';
import type { PlanningIntakeItem, PlanningPlan } from '@ai-team/api-client';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

export function usePlanningIntake(status?: string) {
  const { client } = useTeam();
  const query = useQuery({
    queryKey: contextPanelQueryKeys.planningIntake(status),
    queryFn: () => client.planning.listIntake({ status }) as Promise<PlanningIntakeItem[]>,
  });
  return {
    intakeItems: query.data ?? [],
    intakeLoading: query.isLoading,
    intakeError: query.error,
  };
}

export function usePlans(status?: string) {
  const { client } = useTeam();
  const query = useQuery({
    queryKey: contextPanelQueryKeys.planningPlans(status),
    queryFn: () => client.planning.listPlans({ status }) as Promise<PlanningPlan[]>,
  });
  return {
    plans: query.data ?? [],
    plansLoading: query.isLoading,
    plansError: query.error,
  };
}

export function usePlan(planId: string) {
  const { client } = useTeam();
  const query = useQuery({
    queryKey: contextPanelQueryKeys.planningPlan(planId),
    queryFn: () => client.planning.getPlan(planId) as Promise<PlanningPlan>,
    enabled: !!planId,
  });
  return {
    plan: query.data,
    planLoading: query.isLoading,
    planError: query.error,
  };
}

export function useCreatePlan() {
  const { client } = useTeam();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      title: string;
      goal?: string;
      status?: string;
      priority?: string;
      createdBy?: string;
    }) => client.planning.createPlan(body) as Promise<PlanningPlan>,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planning', 'plans'] });
    },
  });
}

export function useUpdateIntakeStatus() {
  const { client } = useTeam();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ intakeId, status }: { intakeId: string; status: string }) =>
      client.planning.upsertIntake(intakeId, { status } as Omit<
        PlanningIntakeItem,
        'id' | 'createdAt' | 'updatedAt'
      >),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['planning', 'intake'] });
    },
  });
}
