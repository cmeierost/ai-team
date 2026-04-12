import type {
  PermissionAgentResponsibilitySummary,
  PermissionOverlapRegion,
  PermissionRight,
  PermissionRightUncoveredSummary,
} from '../types';

export type PermissionMetricKind = 'lines' | 'files' | 'folders';

export function getPermissionMetricKind(right: PermissionRight): PermissionMetricKind {
  if (right === 'write' || right === 'read') {
    return 'lines';
  }
  return 'files';
}

function formatNumber(value: number): string {
  return value.toLocaleString();
}

export function getRegionMetricValue(region: PermissionOverlapRegion, right: PermissionRight): number {
  const kind = getPermissionMetricKind(right);
  if (kind === 'lines') {
    return region.rightLineCounts[right];
  }
  if (kind === 'folders') {
    return region.rightFolderCounts?.[right] ?? 0;
  }
  return region.rightFileCounts[right];
}

export function formatRightMetric(region: PermissionOverlapRegion, right: PermissionRight): string {
  const value = getRegionMetricValue(region, right);
  return formatMetricValue(right, value);
}

export function formatMetricValue(right: PermissionRight, value: number): string {
  const kind = getPermissionMetricKind(right);
  if (kind === 'lines') {
    return `${formatNumber(value)} lines`;
  }
  if (kind === 'folders') {
    return `${formatNumber(value)} folders`;
  }
  return `${formatNumber(value)} files`;
}

export function formatRightMetricCompact(region: PermissionOverlapRegion, right: PermissionRight): string {
  const value = getRegionMetricValue(region, right);
  return formatMetricValueCompact(right, value);
}

export function formatMetricValueCompact(right: PermissionRight, value: number): string {
  const kind = getPermissionMetricKind(right);
  if (kind === 'lines') {
    return `${formatNumber(value)}L`;
  }
  if (kind === 'folders') {
    return `${formatNumber(value)}D`;
  }
  return `${formatNumber(value)}F`;
}

export function getResponsibilityMetricValue(
  responsibility: PermissionAgentResponsibilitySummary | undefined,
  right: PermissionRight,
): number {
  if (!responsibility) {
    return 0;
  }
  const kind = getPermissionMetricKind(right);
  if (kind === 'lines') {
    return responsibility.rightLineCounts[right];
  }
  if (kind === 'folders') {
    return responsibility.rightFolderCounts?.[right] ?? 0;
  }
  return responsibility.rightFileCounts[right];
}

export function getUncoveredMetricValue(uncovered: PermissionRightUncoveredSummary | undefined, right: PermissionRight): number {
  if (!uncovered) {
    return 0;
  }
  const kind = getPermissionMetricKind(right);
  if (kind === 'lines') {
    return uncovered.lineCount;
  }
  if (kind === 'folders') {
    return uncovered.folderCount;
  }
  return uncovered.fileCount;
}
