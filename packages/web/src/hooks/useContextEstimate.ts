import { useQuery } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';

export interface ContextSegment {
  label: string;
  key: string;
  chars: number;
}

export interface ContextEstimateResponse {
  agentId: string;
  segments: ContextSegment[];
  totalChars: number;
}

export function useContextEstimate(agentId: string | undefined) {
  const { client } = useTeam();
  return useQuery<ContextEstimateResponse>({
    queryKey: ['meta', 'context-estimate', agentId],
    queryFn: () => client.context.getContextEstimate(agentId!) as Promise<ContextEstimateResponse>,
    enabled: !!agentId,
    staleTime: 30_000,
  });
}
