import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '../context/TeamContext';

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
  return useQuery<ContextEstimateResponse>({
    queryKey: ['meta', 'context-estimate', agentId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/meta/context-estimate/${encodeURIComponent(agentId!)}`);
      if (!r.ok) throw new Error(`Failed to load context estimate: ${r.statusText}`);
      return r.json() as Promise<ContextEstimateResponse>;
    },
    enabled: !!agentId,
    staleTime: 30_000,
  });
}
