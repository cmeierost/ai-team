import { useQuery } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';
import type { Artifact } from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

export function useArtifactsQuery() {
  const { client } = useTeam();
  return useQuery({
    queryKey: contextPanelQueryKeys.artifacts(),
    queryFn: () => client.artifacts.list() as Promise<Artifact[]>,
  });
}