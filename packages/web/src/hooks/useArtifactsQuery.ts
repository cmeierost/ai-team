import { useQuery } from '@tanstack/react-query';
import { API_BASE } from '../context/TeamContext';
import type { Artifact } from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

async function fetchArtifacts(): Promise<Artifact[]> {
  const response = await fetch(`${API_BASE}/api/artifacts`);
  if (!response.ok) {
    throw new Error(`Failed to load artifacts: ${response.statusText}`);
  }

  return (await response.json()) as Artifact[];
}

export function useArtifactsQuery() {
  return useQuery({
    queryKey: contextPanelQueryKeys.artifacts(),
    queryFn: fetchArtifacts,
  });
}