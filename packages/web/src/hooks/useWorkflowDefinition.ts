import { useQuery } from '@tanstack/react-query';
import type { WorkflowDefinitionApiResponse } from '@ai-team/api-contracts';
import { useTeam } from '../context/TeamContext';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

export function useWorkflowDefinition(workflowId: string) {
  const { client } = useTeam();
  const normalizedWorkflowId = workflowId.trim();

  const query = useQuery({
    queryKey: contextPanelQueryKeys.workflowDefinition(normalizedWorkflowId),
    queryFn: () =>
      client.context.getWorkflowDefinition(
        normalizedWorkflowId
      ) as Promise<WorkflowDefinitionApiResponse>,
    enabled: normalizedWorkflowId.length > 0,
    retry: false,
  });

  return {
    workflowDefinition: query.data ?? null,
    workflowDefinitionLoading: query.isLoading,
    workflowDefinitionError: query.error,
    refetchWorkflowDefinition: query.refetch,
  };
}
