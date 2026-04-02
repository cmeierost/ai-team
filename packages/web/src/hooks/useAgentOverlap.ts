import { useMemo } from 'react';
import type { PermissionOverlapRegion, PermissionSuggestion } from '../types';
import { usePermissionAnalysis, filterRegionsForAgent } from './usePermissionAnalysis';

export interface AgentOverlapView {
  focusAgentId: string;
  peerRegions: PermissionOverlapRegion[];
  strongestRegion?: PermissionOverlapRegion;
  dominantFileTypes: string[];
  suggestions: PermissionSuggestion[];
}

interface UseAgentOverlapOptions {
  enabled?: boolean;
}

function buildAgentSuggestions(agentId: string, peerRegions: readonly PermissionOverlapRegion[]): PermissionSuggestion[] {
  if (peerRegions.length === 0) {
    return [];
  }

  const writeRegion = [...peerRegions]
    .filter((region) => region.rightFileCounts.write > 0)
    .sort((left, right) =>
      right.rightLineCounts.write - left.rightLineCounts.write
      || right.totalLines - left.totalLines
    )[0];

  const strongestRegion = peerRegions[0];
  const suggestions: PermissionSuggestion[] = [];

  if (writeRegion) {
    suggestions.push({
      id: `agent-write-overlap-${agentId}-${writeRegion.id}`,
      title: `Reduce write overlap with ${writeRegion.peerAgentIds[0]}`,
      severity: 'high',
      rationale: `${writeRegion.rightFileCounts.write} writable files overlap with ${writeRegion.peerAgentIds[0]}. Consider clarifying ownership boundaries for ${writeRegion.fileEndingSummary.slice(0, 2).map((entry) => entry.extension).join(', ')} files.`,
      affectedAgentIds: [agentId, ...writeRegion.peerAgentIds],
      affectedRights: ['write'],
      fileScope: writeRegion.fileEndingSummary.slice(0, 3).map((entry) => `${entry.extension} (${entry.fileCount} files)`),
      fileTypeSummary: writeRegion.fileTypeSummary,
    });
  }

  if (strongestRegion) {
    suggestions.push({
      id: `agent-strongest-overlap-${agentId}-${strongestRegion.id}`,
      title: `Review strongest shared surface with ${strongestRegion.peerAgentIds[0]}`,
      severity: 'medium',
      rationale: `${strongestRegion.totalFiles} shared files and ${strongestRegion.totalLines.toLocaleString()} shared lines make this the densest overlap for ${agentId}. This is a good place to tighten rights or split ownership by file type.`,
      affectedAgentIds: [agentId, ...strongestRegion.peerAgentIds],
      affectedRights: strongestRegion.sharedRights,
      fileScope: strongestRegion.fileEndingSummary.slice(0, 3).map((entry) => `${entry.extension} (${entry.fileCount} files)`),
      fileTypeSummary: strongestRegion.fileTypeSummary,
    });
  }

  return suggestions.slice(0, 3);
}

export function useAgentOverlap(agentId: string | undefined, options: UseAgentOverlapOptions = {}) {
  const query = usePermissionAnalysis({ enabled: options.enabled, selectedFileTypeGroupId: 'all' });

  const view = useMemo<AgentOverlapView | undefined>(() => {
    if (!agentId || !query.view) {
      return undefined;
    }

    const peerRegions = filterRegionsForAgent(query.view, agentId);
    const strongestRegion = peerRegions[0];
    const dominantFileTypes = strongestRegion?.fileEndingSummary.slice(0, 3).map((entry) => entry.extension) ?? [];

    return {
      focusAgentId: agentId,
      peerRegions,
      strongestRegion,
      dominantFileTypes,
      suggestions: buildAgentSuggestions(agentId, peerRegions),
    };
  }, [agentId, query.view]);

  return {
    ...query,
    view,
  };
}
