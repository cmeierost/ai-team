import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTeam } from '../context/TeamContext';
import type {
  FileEndingSummary,
  FileTypeCategory,
  FileTypeSummary,
  PermissionAgentResponsibilitySummary,
  PermissionAnalysisView,
  OutsideDefaultContextRightSummary,
  PermissionOverlapFileOwnershipEntry,
  PermissionOverlapRegion,
  PermissionOverlapReport,
  PermissionRight,
  PermissionRightUncoveredSummary,
  PermissionSuggestion,
} from '../types';
import { contextPanelQueryKeys } from './contextPanelQueryKeys';

const RIGHTS: PermissionRight[] = ['read', 'write', 'list'];
const CATEGORY_ORDER: FileTypeCategory[] = ['code', 'documentation', 'configuration', 'tests', 'assets', 'other'];

function createRightCounts(): Record<PermissionRight, number> {
  return {
    read: 0,
    write: 0,
    create: 0,
    delete: 0,
    list: 0,
  };
}

function buildUncoveredByRight(
  report: Extract<PermissionOverlapReport, { kind: 'files' }>,
  matcher: (file: PermissionOverlapFileOwnershipEntry) => boolean,
): Record<PermissionRight, number> {
  return RIGHTS.reduce((acc, right) => {
    acc[right] = report.rights[right].uncoveredFiles.filter(matcher).length;
    return acc;
  }, createRightCounts());
}

function categoryRank(category: FileTypeCategory): number {
  return CATEGORY_ORDER.indexOf(category);
}

function inferFileTypeCategory(extension: string, filePath?: string): FileTypeCategory {
  const normalizedExt = extension.toLowerCase();
  const normalizedPath = (filePath ?? '').toLowerCase();

  if (
    normalizedPath.includes('.test.')
    || normalizedPath.includes('.spec.')
    || normalizedPath.includes('__tests__')
    || normalizedExt === '.snap'
  ) {
    return 'tests';
  }

  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c', '.h', '.hpp', '.rb', '.php', '.swift', '.kt', '.sql', '.sh', '.ps1', '.html', '.css', '.scss', '.sass', '.less', '.vue', '.svelte'].includes(normalizedExt)) {
    return 'code';
  }

  if (['.md', '.mdx', '.txt', '.rst', '.adoc'].includes(normalizedExt)) {
    return 'documentation';
  }

  if (['.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.env', '.conf', '.config', '.properties', '.lock'].includes(normalizedExt)) {
    return 'configuration';
  }

  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp', '.mp4', '.mov', '.mp3', '.wav', '.pdf'].includes(normalizedExt)) {
    return 'assets';
  }

  return 'other';
}

function summarizeEndingEntries(
  entries: Iterable<{ extension: string; fileCount: number; lineCount: number }>,
): FileEndingSummary[] {
  const aggregate = new Map<string, { fileCount: number; lineCount: number }>();

  for (const entry of entries) {
    const current = aggregate.get(entry.extension) ?? { fileCount: 0, lineCount: 0 };
    current.fileCount += entry.fileCount;
    current.lineCount += entry.lineCount;
    aggregate.set(entry.extension, current);
  }

  return [...aggregate.entries()]
    .map(([extension, counts]) => ({
      extension,
      fileCount: counts.fileCount,
      lineCount: counts.lineCount,
      category: inferFileTypeCategory(extension),
    }))
    .sort((left, right) =>
      right.lineCount - left.lineCount
      || right.fileCount - left.fileCount
      || left.extension.localeCompare(right.extension)
    );
}

function summarizeFilesByEnding(files: readonly PermissionOverlapFileOwnershipEntry[]): FileEndingSummary[] {
  return summarizeEndingEntries(
    files.map((file) => ({
      extension: file.extension,
      fileCount: 1,
      lineCount: file.lineCount,
    })),
  );
}

function summarizeFilesByCategory(files: readonly PermissionOverlapFileOwnershipEntry[]): FileTypeSummary[] {
  const aggregate = new Map<FileTypeCategory, { fileCount: number; lineCount: number; extensions: Set<string> }>();

  for (const file of files) {
    const category = inferFileTypeCategory(file.extension, file.path);
    const current = aggregate.get(category) ?? { fileCount: 0, lineCount: 0, extensions: new Set<string>() };
    current.fileCount += 1;
    current.lineCount += file.lineCount;
    current.extensions.add(file.extension);
    aggregate.set(category, current);
  }

  return [...aggregate.entries()]
    .map(([category, counts]) => ({
      category,
      fileCount: counts.fileCount,
      lineCount: counts.lineCount,
      extensions: [...counts.extensions].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) =>
      right.lineCount - left.lineCount
      || right.fileCount - left.fileCount
      || categoryRank(left.category) - categoryRank(right.category)
    );
}

function dedupeFiles(files: readonly PermissionOverlapFileOwnershipEntry[]): PermissionOverlapFileOwnershipEntry[] {
  const byPath = new Map<string, PermissionOverlapFileOwnershipEntry>();

  for (const file of files) {
    if (!byPath.has(file.path)) {
      byPath.set(file.path, file);
    }
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function intersectGloballyUncoveredFiles(report: Extract<PermissionOverlapReport, { kind: 'files' }>) {
  const rightMaps = RIGHTS.map((right) => {
    const map = new Map<string, PermissionOverlapFileOwnershipEntry>();
    for (const file of report.rights[right].uncoveredFiles) {
      map.set(file.path, file);
    }
    return map;
  });

  const [first, ...rest] = rightMaps;
  return [...first.values()]
    .filter((file) => rest.every((map) => map.has(file.path)))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function pairKey(agentA: string, agentB: string): string {
  return [agentA, agentB].sort((left, right) => left.localeCompare(right)).join('::');
}

interface RegionAggregate {
  focusAgentId: string;
  peerAgentIds: string[];
  sharedRights: Set<PermissionRight>;
  rightFileCounts: Record<PermissionRight, number>;
  rightLineCounts: Record<PermissionRight, number>;
  rightFolderCounts: Record<PermissionRight, number>;
  rightOverlapRatio: Record<PermissionRight, number>;
  overlapRatio: number;
  sharedFiles: PermissionOverlapFileOwnershipEntry[];
  rightSharedFiles: Partial<Record<PermissionRight, PermissionOverlapFileOwnershipEntry[]>>;
}

function getParentDirectory(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx <= 0 ? '.' : normalized.slice(0, idx);
}

function buildRegions(report: Extract<PermissionOverlapReport, { kind: 'files' }>): PermissionOverlapRegion[] {
  const aggregate = new Map<string, RegionAggregate>();

  for (const right of RIGHTS) {
    for (const pair of report.rights[right].pairs) {
      if (pair.sharedFileCount === 0) {
        continue;
      }

      const key = pairKey(pair.agentA, pair.agentB);
      const existing: RegionAggregate = aggregate.get(key) ?? {
        focusAgentId: pair.agentA,
        peerAgentIds: [pair.agentB],
        sharedRights: new Set<PermissionRight>(),
        rightFileCounts: createRightCounts(),
        rightLineCounts: createRightCounts(),
        rightFolderCounts: createRightCounts(),
        rightOverlapRatio: createRightCounts(),
        overlapRatio: 0,
        sharedFiles: [] as PermissionOverlapFileOwnershipEntry[],
        rightSharedFiles: {} as Partial<Record<PermissionRight, PermissionOverlapFileOwnershipEntry[]>>,
      };

      existing.sharedRights.add(right);
      existing.rightFileCounts[right] = pair.sharedFileCount;
      existing.rightLineCounts[right] = pair.sharedLineCount;
      existing.rightFolderCounts[right] = new Set(pair.sharedFiles.map((file) => getParentDirectory(file.path))).size;
      existing.rightOverlapRatio[right] = pair.overlapRatio;
      existing.overlapRatio = Math.max(existing.overlapRatio, pair.overlapRatio);
      existing.sharedFiles.push(...pair.sharedFiles);
      existing.rightSharedFiles[right] = pair.sharedFiles;
      aggregate.set(key, existing);
    }
  }

  return [...aggregate.entries()]
    .map(([id, entry]) => {
      const sharedFiles = dedupeFiles(entry.sharedFiles);
      const fileEndingSummary = summarizeFilesByEnding(sharedFiles);
      const fileTypeSummary = summarizeFilesByCategory(sharedFiles);
      const rightFileEndingSummary = RIGHTS.reduce((acc, right) => {
        const filesForRight = dedupeFiles(entry.rightSharedFiles[right] ?? []);
        acc[right] = summarizeFilesByEnding(filesForRight);
        return acc;
      }, {} as Partial<Record<PermissionRight, FileEndingSummary[]>>);
      const rightFileTypeSummary = RIGHTS.reduce((acc, right) => {
        const filesForRight = dedupeFiles(entry.rightSharedFiles[right] ?? []);
        acc[right] = summarizeFilesByCategory(filesForRight);
        return acc;
      }, {} as Partial<Record<PermissionRight, FileTypeSummary[]>>);
      const agentIds = id.split('::');
      return {
        id,
        label: agentIds.join(' + '),
        focusAgentId: agentIds[0],
        peerAgentIds: [agentIds[1]],
        totalFiles: sharedFiles.length,
        totalLines: sharedFiles.reduce((sum, file) => sum + file.lineCount, 0),
        overlapRatio: entry.overlapRatio,
        sharedRights: RIGHTS.filter((right) => entry.sharedRights.has(right)),
        rightFileCounts: entry.rightFileCounts,
        rightLineCounts: entry.rightLineCounts,
        rightFolderCounts: entry.rightFolderCounts,
        rightOverlapRatio: entry.rightOverlapRatio,
        rightSharedFiles: RIGHTS.reduce((acc, right) => {
          acc[right] = dedupeFiles(entry.rightSharedFiles[right] ?? []);
          return acc;
        }, {} as Partial<Record<PermissionRight, PermissionOverlapFileOwnershipEntry[]>>),
        rightFileEndingSummary,
        rightFileTypeSummary,
        fileEndingSummary,
        fileTypeSummary,
        sharedFiles,
      } satisfies PermissionOverlapRegion;
    })
    .sort((left, right) =>
      right.totalLines - left.totalLines
      || right.totalFiles - left.totalFiles
      || right.overlapRatio - left.overlapRatio
      || left.label.localeCompare(right.label)
    );
}

function buildUncoveredSuggestion(files: readonly PermissionOverlapFileOwnershipEntry[]): PermissionSuggestion[] {
  const byExtension = summarizeFilesByEnding(files).slice(0, 3);
  return byExtension.map((summary, index) => ({
    id: `uncovered-${summary.extension}-${index}`,
    title: `Assign uncovered ${summary.extension} files`,
    severity: index === 0 ? 'high' : 'medium',
    rationale: `${summary.fileCount} uncovered files (${summary.lineCount.toLocaleString()} lines) use ${summary.extension}, which suggests an unowned workspace area that should be assigned.`,
    affectedAgentIds: [],
    affectedRights: ['read', 'write'],
    fileScope: [`Files ending in ${summary.extension}`],
    fileTypeSummary: [{ category: summary.category, fileCount: summary.fileCount, lineCount: summary.lineCount, extensions: [summary.extension] }],
  }));
}

function buildWriteOverlapSuggestions(regions: readonly PermissionOverlapRegion[]): PermissionSuggestion[] {
  return regions
    .filter((region) => region.rightFileCounts.write > 0)
    .slice(0, 3)
    .map((region, index) => ({
      id: `write-overlap-${region.id}`,
      title: `Review write overlap between ${region.id.replace('::', ' and ')}`,
      severity: index === 0 ? 'high' : 'medium',
      rationale: `${region.rightFileCounts.write} shared writable files (${region.rightLineCounts.write.toLocaleString()} lines) can create unclear ownership and coordination risk.`,
      affectedAgentIds: region.id.split('::'),
      affectedRights: ['write'],
      fileScope: region.fileEndingSummary.slice(0, 3).map((entry) => `${entry.extension} (${entry.fileCount} files)`),
      fileTypeSummary: region.fileTypeSummary,
    }));
}

function buildSparseOwnershipSuggestions(report: Extract<PermissionOverlapReport, { kind: 'files' }>): PermissionSuggestion[] {
  const candidates = report.rights.write.agentResponsibilities
    .filter((entry) => entry.fileCount > 0)
    .sort((left, right) => left.fileCount - right.fileCount || left.agentId.localeCompare(right.agentId))
    .slice(0, 2);

  return candidates.map((entry) => ({
    id: `sparse-owner-${entry.agentId}`,
    title: `Check whether ${entry.agentId} needs broader ownership`,
    severity: 'low',
    rationale: `${entry.agentId} currently owns only ${entry.fileCount} writable files, which may indicate missing assignment coverage or an intentionally narrow scope that should be confirmed.`,
    affectedAgentIds: [entry.agentId],
    affectedRights: ['write'],
    fileScope: entry.byExtension.slice(0, 3).map((item) => `${item.extension} (${item.fileCount} files)`),
    fileTypeSummary: summarizeEndingEntries(entry.byExtension).map((item) => ({
      category: item.category,
      fileCount: item.fileCount,
      lineCount: item.lineCount,
      extensions: [item.extension],
    })),
  }));
}

function buildSuggestions(
  report: Extract<PermissionOverlapReport, { kind: 'files' }>,
  regions: readonly PermissionOverlapRegion[],
  globallyUncoveredFiles: readonly PermissionOverlapFileOwnershipEntry[],
): PermissionSuggestion[] {
  return [
    ...buildUncoveredSuggestion(globallyUncoveredFiles),
    ...buildWriteOverlapSuggestions(regions),
    ...buildSparseOwnershipSuggestions(report),
  ].slice(0, 8);
}

function buildRightUncovered(report: Extract<PermissionOverlapReport, { kind: 'files' }>): Record<PermissionRight, PermissionRightUncoveredSummary> {
  return RIGHTS.reduce((acc, right) => {
    const files = report.rights[right].uncoveredFiles;
    acc[right] = {
      fileCount: files.length,
      lineCount: files.reduce((sum, file) => sum + file.lineCount, 0),
      folderCount: new Set(files.map((file) => getParentDirectory(file.path))).size,
    };
    return acc;
  }, {} as Record<PermissionRight, PermissionRightUncoveredSummary>);
}

function buildTotalContextByRight(report: Extract<PermissionOverlapReport, { kind: 'files' }>): Record<PermissionRight, number> {
  return RIGHTS.reduce((acc, right) => {
    const summary = report.rights[right];
    const coveredFiles = [...summary.singlyOwnedFiles, ...summary.overlappingFiles];

    if (right === 'read' || right === 'write') {
      acc[right] = coveredFiles.reduce((sum, file) => sum + file.lineCount, 0);
      return acc;
    }

    if (right === 'create') {
      const directories = new Set<string>();
      for (const file of coveredFiles) {
        directories.add(getParentDirectory(file.path));
      }
      acc[right] = directories.size;
      return acc;
    }

    acc[right] = coveredFiles.length;
    return acc;
  }, {} as Record<PermissionRight, number>);
}

function buildOutsideDefaultContextByAgent(
  report: Extract<PermissionOverlapReport, { kind: 'files' }>,
): Record<string, Record<PermissionRight, OutsideDefaultContextRightSummary>> {
  const entries = report.outsideDefaultContextByAgent ?? [];
  return Object.fromEntries(entries.map((entry) => [entry.agentId, entry.rights]));
}

function isBinaryExtension(extension: string): boolean {
  const normalized = extension.toLowerCase();
  return [
    '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.svg',
    '.pdf', '.zip', '.gz', '.tar', '.7z', '.jar',
    '.db', '.sqlite', '.sqlite3',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.mp3', '.mp4', '.mov', '.avi', '.wav',
    '.exe', '.dll', '.so', '.dylib',
  ].includes(normalized);
}

function buildAgentResponsibilities(report: Extract<PermissionOverlapReport, { kind: 'files' }>): Record<string, PermissionAgentResponsibilitySummary> {
  const map = new Map<string, PermissionAgentResponsibilitySummary>();

  for (const right of RIGHTS) {
    for (const entry of report.rights[right].agentResponsibilities) {
      const current = map.get(entry.agentId) ?? {
        rightFileCounts: createRightCounts(),
        rightLineCounts: createRightCounts(),
        rightFolderCounts: createRightCounts(),
      };
      current.rightFileCounts[right] = entry.fileCount;
      current.rightLineCounts[right] = entry.lineCount;
      current.rightFolderCounts![right] = entry.byExtension.length;
      map.set(entry.agentId, current);
    }
  }

  return Object.fromEntries(map.entries());
}

export function buildPermissionAnalysisView(report: PermissionOverlapReport): PermissionAnalysisView {
  if (report.kind !== 'files') {
    throw new Error('The permissions analysis UI currently requires file-based overlap data.');
  }

  const globallyUncoveredFiles = intersectGloballyUncoveredFiles(report);
  const regions = buildRegions(report);
  const strongest = regions[0];
  const suggestions = buildSuggestions(report, regions, globallyUncoveredFiles);
  const rightUncovered = buildRightUncovered(report);
  const agentResponsibilities = buildAgentResponsibilities(report);
  const totalAgentContextByRight = buildTotalContextByRight(report);
  const defaultContextByRight = {
    read: report.rights.read.totalFiles - report.rights.read.uncoveredFiles.length,
    write: report.rights.read.totalFiles - report.rights.read.uncoveredFiles.length,
    create: report.rights.read.totalFiles - report.rights.read.uncoveredFiles.length,
    delete: report.rights.read.totalFiles - report.rights.read.uncoveredFiles.length,
    list: report.rights.read.totalFiles - report.rights.read.uncoveredFiles.length,
  } satisfies Record<PermissionRight, number>;
  const defaultReadContextFileCount = report.rights.read.totalFiles - report.rights.read.uncoveredFiles.length;
  const defaultReadContextLineCount = [...report.rights.read.singlyOwnedFiles, ...report.rights.read.overlappingFiles]
    .reduce((sum, file) => sum + file.lineCount, 0);
  const outsideDefaultContextByAgent = buildOutsideDefaultContextByAgent(report);
  const workspaceReadFiles = dedupeFiles([
    ...report.rights.read.uncoveredFiles,
    ...report.rights.read.singlyOwnedFiles,
    ...report.rights.read.overlappingFiles,
  ]);
  const workspaceCodeFiles = workspaceReadFiles.filter((file) => inferFileTypeCategory(file.extension, file.path) === 'code');
  const workspaceDocumentationFiles = workspaceReadFiles.filter((file) => inferFileTypeCategory(file.extension, file.path) === 'documentation');
  const workspaceBinaryFiles = workspaceReadFiles.filter((file) => isBinaryExtension(file.extension));
  const workspaceCodeUncoveredFiles = report.rights.read.uncoveredFiles
    .filter((file) => inferFileTypeCategory(file.extension, file.path) === 'code');
  const workspaceDocumentationUncoveredFiles = report.rights.read.uncoveredFiles
    .filter((file) => inferFileTypeCategory(file.extension, file.path) === 'documentation');
  const workspaceBinaryUncoveredFiles = report.rights.read.uncoveredFiles
    .filter((file) => isBinaryExtension(file.extension));
  const workspaceCodeUncoveredByRight = buildUncoveredByRight(
    report,
    (file) => inferFileTypeCategory(file.extension, file.path) === 'code',
  );
  const workspaceDocumentationUncoveredByRight = buildUncoveredByRight(
    report,
    (file) => inferFileTypeCategory(file.extension, file.path) === 'documentation',
  );
  const workspaceBinaryUncoveredByRight = buildUncoveredByRight(
    report,
    (file) => isBinaryExtension(file.extension),
  );

  return {
    generatedAt: report.generatedAt,
    workspaceFileCount: report.workspaceFileCount,
    workspaceUncoveredFileCount: report.rights.read.uncoveredFiles.length,
    workspaceCodeFileCount: workspaceCodeFiles.length,
    workspaceCodeLineCount: workspaceCodeFiles.reduce((sum, file) => sum + file.lineCount, 0),
    workspaceCodeUncoveredFileCount: workspaceCodeUncoveredFiles.length,
    workspaceCodeUncoveredByRight,
    workspaceDocumentationFileCount: workspaceDocumentationFiles.length,
    workspaceDocumentationUncoveredFileCount: workspaceDocumentationUncoveredFiles.length,
    workspaceDocumentationUncoveredByRight,
    workspaceBinaryFileCount: workspaceBinaryFiles.length,
    workspaceBinaryUncoveredFileCount: workspaceBinaryUncoveredFiles.length,
    workspaceBinaryUncoveredByRight,
    agentIds: report.agentIds,
    defaultContextByRight,
    defaultReadContextFileCount,
    defaultReadContextLineCount,
    totalAgentContextByRight,
    globallyUncoveredFiles,
    uncoveredFileEndings: summarizeFilesByEnding(globallyUncoveredFiles),
    uncoveredFileTypes: summarizeFilesByCategory(globallyUncoveredFiles),
    rightUncovered,
    agentResponsibilities,
    outsideDefaultContextByAgent,
    regions,
    suggestions,
    summary: {
      totalAgents: report.agentIds.length,
      totalOverlappingPairs: regions.length,
      totalGloballyUncoveredFiles: globallyUncoveredFiles.length,
      totalMultiWriteFiles: report.rights.write.overlappingFiles.length,
      strongestOverlapRegionId: strongest?.id,
    },
  };
}

interface UsePermissionAnalysisOptions {
  enabled?: boolean;
}

export function usePermissionAnalysis(options: UsePermissionAnalysisOptions = {}) {
  const { client } = useTeam();

  const query = useQuery<PermissionOverlapReport>({
    queryKey: contextPanelQueryKeys.permissionAnalysis(),
    queryFn: () => client.analyzePermissionOverlap({ mode: 'files' }) as Promise<PermissionOverlapReport>,
    staleTime: 30_000,
    enabled: options.enabled ?? false,
  });

  const view = useMemo(
    () => (query.data ? buildPermissionAnalysisView(query.data) : undefined),
    [query.data],
  );

  return {
    ...query,
    view,
    analyze: query.refetch,
  };
}

export function filterRegionsForAgent(view: PermissionAnalysisView, agentId: string): PermissionOverlapRegion[] {
  return view.regions
    .filter((region) => region.id.split('::').includes(agentId))
    .map((region) => {
      const [agentA, agentB] = region.id.split('::');
      const peerAgentId = agentA === agentId ? agentB : agentA;
      return {
        ...region,
        focusAgentId: agentId,
        peerAgentIds: [peerAgentId],
      };
    })
    .sort((left, right) =>
      right.totalLines - left.totalLines
      || right.totalFiles - left.totalFiles
      || left.peerAgentIds[0].localeCompare(right.peerAgentIds[0])
    );
}

