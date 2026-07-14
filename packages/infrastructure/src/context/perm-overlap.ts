import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  analyzePermOverlap,
  listWorkspaceFiles,
  matchesPattern,
  parseAccessFile,
  type AgentRuleMap,
  type FlatFileEntry,
  type PermissionOverlapReport as PatternPermissionOverlapReport,
  type RightOverlapSummary,
  PermFileRegistry,
} from 'fs-context';
import type { PermissionRule, Right, FileTypeGroupConfig } from '@ai-team/core';
import { AgentDocumentStorage } from '../agent/agent-document-storage.js';
import { MarkdownSectionService } from '../agent/markdown-service.js';
import { WorkspaceDiscoveryStorage } from '../agent/workspace-discovery-storage.js';
import { WorkspaceStorage } from '../agent/workspace-storage.js';
import { AgentManager } from '../agent/index.js';

export type PermissionOverlapMode = 'files' | 'patterns';

export interface AnalyzePermissionOverlapOptions {
  mode?: PermissionOverlapMode;
  agentId?: string;
  maxDepth?: number;
}

export interface FileResponsibilityByExtension {
  extension: string;
  fileCount: number;
  lineCount: number;
}

export interface FileOwnershipEntry {
  path: string;
  extension: string;
  lineCount: number;
  agentIds: string[];
}

export interface FileRightAgentResponsibility {
  agentId: string;
  fileCount: number;
  lineCount: number;
  byExtension: FileResponsibilityByExtension[];
}

export interface FileAgentPairOverlap {
  agentA: string;
  agentB: string;
  sharedFileCount: number;
  sharedLineCount: number;
  unionFileCount: number;
  overlapRatio: number;
  sharedFiles: FileOwnershipEntry[];
  byExtension: FileResponsibilityByExtension[];
}

export interface FileRightCoverageSummary {
  right: Right;
  totalFiles: number;
  uncoveredFiles: FileOwnershipEntry[];
  singlyOwnedFiles: FileOwnershipEntry[];
  overlappingFiles: FileOwnershipEntry[];
  agentResponsibilities: FileRightAgentResponsibility[];
  pairs: FileAgentPairOverlap[];
}

export interface OutsideDefaultContextRightSummary {
  fileCount: number;
  lineCount: number;
  files: FileOwnershipEntry[];
}

export interface AgentOutsideDefaultContextSummary {
  agentId: string;
  rights: Record<Right, OutsideDefaultContextRightSummary>;
}

export interface AgentFocusedOverlapRightSummary {
  right: Right;
  responsibility: FileRightAgentResponsibility;
  overlapsWith: Array<{
    otherAgentId: string;
    sharedFileCount: number;
    sharedLineCount: number;
    overlapRatio: number;
    sharedFiles: FileOwnershipEntry[];
    byExtension: FileResponsibilityByExtension[];
  }>;
  uniqueFiles: FileOwnershipEntry[];
  globallyUncoveredFiles: FileOwnershipEntry[];
}

export interface AgentFocusedOverlapSummary {
  agentId: string;
  rights: Record<Right, AgentFocusedOverlapRightSummary>;
}

export interface FilePermissionOverlapReport {
  kind: 'files';
  generatedAt: string;
  agentIds: string[];
  workspaceFileCount: number;
  fileTypeGroups: Record<string, FileTypeGroupConfig>;
  rights: Record<Right, FileRightCoverageSummary>;
  outsideDefaultContextByAgent: AgentOutsideDefaultContextSummary[];
  agentFocus?: AgentFocusedOverlapSummary;
}

export interface PatternOverlapReport {
  kind: 'patterns';
  generatedAt: string;
  agentIds: string[];
  rights: Record<Right, RightOverlapSummary>;
}

export type PermissionOverlapReport = FilePermissionOverlapReport | PatternOverlapReport;

interface FileRecord {
  path: string;
  extension: string;
  lineCount: number;
}

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.bmp',
  '.svg',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.jar',
  '.db',
  '.sqlite',
  '.sqlite3',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.mp3',
  '.mp4',
  '.mov',
  '.avi',
  '.wav',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
]);

const LINE_COUNT_CONCURRENCY = 32;
const EXCLUDED_ANALYSIS_DIR_SEGMENTS = new Set([
  'storybook-static',
  'coverage',
  '.nyc_output',
  '.cache',
  '.output',
  'out',
]);

const DEFAULT_FILE_TYPE_GROUPS: Record<string, FileTypeGroupConfig> = {
  code: {
    label: 'Code',
    patterns: [
      '*.ts',
      '*.tsx',
      '*.js',
      '*.jsx',
      '*.mjs',
      '*.cjs',
      '*.py',
      '*.go',
      '*.rs',
      '*.java',
      '*.cs',
      '*.cpp',
      '*.c',
      '*.h',
      '*.hpp',
      '*.rb',
      '*.php',
      '*.swift',
      '*.kt',
      '*.sql',
      '*.sh',
      '*.ps1',
      '*.html',
      '*.css',
      '*.scss',
      '*.sass',
      '*.less',
      '*.vue',
      '*.svelte',
    ],
  },
  documentation: {
    label: 'Documentation',
    patterns: ['*.md', '*.mdx', '*.txt', '*.rst', '*.adoc'],
  },
  configuration: {
    label: 'Configuration',
    patterns: [
      '*.json',
      '*.jsonc',
      '*.yaml',
      '*.yml',
      '*.toml',
      '*.ini',
      '*.env',
      '*.conf',
      '*.config',
      '*.properties',
      '*.lock',
    ],
  },
  tests: {
    label: 'Tests',
    patterns: ['*.test.*', '*.spec.*', '**/__tests__/**', '*.snap'],
  },
  binaries: {
    label: 'Binaries',
    patterns: [
      '*.png',
      '*.jpg',
      '*.jpeg',
      '*.gif',
      '*.webp',
      '*.ico',
      '*.bmp',
      '*.svg',
      '*.pdf',
      '*.zip',
      '*.gz',
      '*.tar',
      '*.7z',
      '*.jar',
      '*.db',
      '*.sqlite',
      '*.sqlite3',
      '*.woff',
      '*.woff2',
      '*.ttf',
      '*.otf',
      '*.eot',
      '*.mp3',
      '*.mp4',
      '*.mov',
      '*.avi',
      '*.wav',
      '*.exe',
      '*.dll',
      '*.so',
      '*.dylib',
    ],
  },
  assets: {
    label: 'Assets',
    patterns: [
      '*.png',
      '*.jpg',
      '*.jpeg',
      '*.gif',
      '*.webp',
      '*.ico',
      '*.bmp',
      '*.svg',
      '*.mp3',
      '*.mp4',
      '*.mov',
      '*.avi',
      '*.wav',
    ],
  },
  other: {
    label: 'Other',
    patterns: [],
  },
};

function normalizeFileTypeGroups(
  configured: Record<string, FileTypeGroupConfig> | undefined
): Record<string, FileTypeGroupConfig> {
  const configuredGroups = configured ?? {};
  const merged: Record<string, FileTypeGroupConfig> = {};
  const source = {
    ...DEFAULT_FILE_TYPE_GROUPS,
    ...configuredGroups,
  };
  for (const [id, group] of Object.entries(source)) {
    const normalizedId = id.trim();
    if (normalizedId.length === 0) {
      continue;
    }
    merged[normalizedId] = {
      label: group.label?.trim() || normalizedId,
      patterns: [
        ...new Set(
          (group.patterns && group.patterns.length > 0 ? group.patterns : (group.extensions ?? []))
            .map((pattern) => pattern.trim().toLowerCase())
            .filter((pattern) => pattern.length > 0)
            .map((pattern) => (pattern.startsWith('.') ? `*${pattern}` : pattern))
        ),
      ],
    };
  }
  return merged;
}

function shouldExcludeFromFileOverlap(relativePath: string, gitignored?: boolean): boolean {
  if (gitignored) {
    return true;
  }

  const normalized = relativePath.replaceAll('\\', '/');
  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => EXCLUDED_ANALYSIS_DIR_SEGMENTS.has(segment))) {
    return true;
  }

  return false;
}

function normalizePermPattern(pattern: string): string {
  return pattern.replaceAll('\\', '/').trim();
}

function normalizeRule(rule: PermissionRule): PermissionRule {
  return {
    ...rule,
    pathPattern: normalizePermPattern(rule.pathPattern),
  };
}

function createRightRecord<T>(factory: (right: Right) => T): Record<Right, T> {
  return {
    read: factory('read'),
    write: factory('write'),
    list: factory('list'),
  };
}

function normalizeExtension(relativePath: string, entryExtension?: string): string {
  const extension = entryExtension ?? path.posix.extname(relativePath);
  return extension && extension.length > 0 ? extension.toLowerCase() : '[no extension]';
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  return content.split(/\r?\n/).length;
}

async function readLineCount(absolutePath: string): Promise<number> {
  try {
    const content = await readFile(absolutePath, 'utf8');
    return countLines(content);
  } catch {
    return 0;
  }
}

function summarizeByExtension(
  files: readonly FileOwnershipEntry[]
): FileResponsibilityByExtension[] {
  const map = new Map<string, { fileCount: number; lineCount: number }>();

  for (const file of files) {
    const current = map.get(file.extension) ?? { fileCount: 0, lineCount: 0 };
    current.fileCount += 1;
    current.lineCount += file.lineCount;
    map.set(file.extension, current);
  }

  return [...map.entries()]
    .map(([extension, counts]) => ({
      extension,
      fileCount: counts.fileCount,
      lineCount: counts.lineCount,
    }))
    .sort(
      (left, right) =>
        right.lineCount - left.lineCount ||
        right.fileCount - left.fileCount ||
        left.extension.localeCompare(right.extension)
    );
}

function toOwnershipEntry(file: FileRecord, agentIds: string[]): FileOwnershipEntry {
  return {
    path: file.path,
    extension: file.extension,
    lineCount: file.lineCount,
    agentIds: [...agentIds].sort((a, b) => a.localeCompare(b)),
  };
}

function buildPatternReport(patternReport: PatternPermissionOverlapReport): PatternOverlapReport {
  return {
    kind: 'patterns',
    generatedAt: patternReport.generatedAt,
    agentIds: patternReport.agentIds,
    rights: patternReport.rights,
  };
}

function mergeUniquePatterns(...groups: ReadonlyArray<readonly string[]>): string[] {
  return [
    ...new Set(
      groups
        .flat()
        .map((pattern) => pattern.trim())
        .filter((pattern) => pattern.length > 0)
    ),
  ];
}

async function mergeAgentAccessPatterns(
  permRegistry: PermFileRegistry,
  agents: readonly Awaited<ReturnType<AgentManager['getAllAgentsAsync']>>[number][]
): Promise<Awaited<ReturnType<AgentManager['getAllAgentsAsync']>>> {
  return Promise.all(
    agents.map(async (agent) => {
      const persistedPatterns = await permRegistry.loadAsync(agent.id);

      return {
        ...agent,
        permissions: {
          ...agent.permissions,
          list: mergeUniquePatterns(agent.permissions?.list ?? [], persistedPatterns.list),
          read: mergeUniquePatterns(agent.permissions?.read ?? [], persistedPatterns.read),
          write: mergeUniquePatterns(agent.permissions?.write ?? [], persistedPatterns.write),
        },
      };
    })
  );
}

async function toFileRecords(entries: FlatFileEntry[]): Promise<FileRecord[]> {
  const records: FileRecord[] = [];
  const filteredEntries = entries.filter(
    (entry) => !shouldExcludeFromFileOverlap(entry.relativePath, entry.gitignored)
  );

  for (let index = 0; index < filteredEntries.length; index += LINE_COUNT_CONCURRENCY) {
    const batch = filteredEntries.slice(index, index + LINE_COUNT_CONCURRENCY);
    const batchRecords = await Promise.all(
      batch.map(async (entry) => {
        const extension = normalizeExtension(entry.relativePath, entry.extension);
        return {
          path: entry.relativePath,
          extension,
          lineCount: BINARY_EXTENSIONS.has(extension) ? 0 : await readLineCount(entry.path),
        };
      })
    );
    records.push(...batchRecords);
  }

  records.sort((left, right) => left.path.localeCompare(right.path));
  return records;
}

function buildAgentResponsibilities(
  agentIds: readonly string[],
  files: readonly FileRecord[],
  ownershipByPath: Map<string, string[]>
): FileRightAgentResponsibility[] {
  return agentIds
    .map((agentId) => {
      const owned = files
        .filter((file) => (ownershipByPath.get(file.path) ?? []).includes(agentId))
        .map((file) => toOwnershipEntry(file, [agentId]));

      return {
        agentId,
        fileCount: owned.length,
        lineCount: owned.reduce((sum, file) => sum + file.lineCount, 0),
        byExtension: summarizeByExtension(owned),
      };
    })
    .sort(
      (left, right) =>
        right.lineCount - left.lineCount ||
        right.fileCount - left.fileCount ||
        left.agentId.localeCompare(right.agentId)
    );
}

function buildPairOverlaps(
  agentIds: readonly string[],
  files: readonly FileRecord[],
  ownershipByPath: Map<string, string[]>
): FileAgentPairOverlap[] {
  const pairs: FileAgentPairOverlap[] = [];

  for (let index = 0; index < agentIds.length; index += 1) {
    const agentA = agentIds[index];
    const filesA = files.filter((file) => (ownershipByPath.get(file.path) ?? []).includes(agentA));
    const fileSetA = new Set(filesA.map((file) => file.path));

    for (let inner = index + 1; inner < agentIds.length; inner += 1) {
      const agentB = agentIds[inner];
      const filesB = files.filter((file) =>
        (ownershipByPath.get(file.path) ?? []).includes(agentB)
      );
      const fileSetB = new Set(filesB.map((file) => file.path));

      const sharedFiles = files
        .filter((file) => fileSetA.has(file.path) && fileSetB.has(file.path))
        .map((file) => toOwnershipEntry(file, [agentA, agentB]));

      const unionFileCount = new Set([...fileSetA, ...fileSetB]).size;
      const sharedLineCount = sharedFiles.reduce((sum, file) => sum + file.lineCount, 0);

      pairs.push({
        agentA,
        agentB,
        sharedFileCount: sharedFiles.length,
        sharedLineCount,
        unionFileCount,
        overlapRatio: unionFileCount === 0 ? 0 : sharedFiles.length / unionFileCount,
        sharedFiles,
        byExtension: summarizeByExtension(sharedFiles),
      });
    }
  }

  pairs.sort(
    (left, right) =>
      right.sharedFileCount - left.sharedFileCount ||
      right.sharedLineCount - left.sharedLineCount ||
      right.overlapRatio - left.overlapRatio ||
      left.agentA.localeCompare(right.agentA) ||
      left.agentB.localeCompare(right.agentB)
  );

  return pairs;
}

function buildAgentFocus(
  agentId: string,
  rights: Record<Right, FileRightCoverageSummary>
): AgentFocusedOverlapSummary {
  return {
    agentId,
    rights: createRightRecord((right) => {
      const summary = rights[right];
      const responsibility = summary.agentResponsibilities.find(
        (entry) => entry.agentId === agentId
      ) ?? {
        agentId,
        fileCount: 0,
        lineCount: 0,
        byExtension: [],
      };

      const overlapsWith = summary.pairs
        .filter((pair) => pair.agentA === agentId || pair.agentB === agentId)
        .map((pair) => ({
          otherAgentId: pair.agentA === agentId ? pair.agentB : pair.agentA,
          sharedFileCount: pair.sharedFileCount,
          sharedLineCount: pair.sharedLineCount,
          overlapRatio: pair.overlapRatio,
          sharedFiles: pair.sharedFiles,
          byExtension: pair.byExtension,
        }));

      const uniqueFiles = summary.singlyOwnedFiles.filter((file) => file.agentIds[0] === agentId);

      return {
        right,
        responsibility,
        overlapsWith,
        uniqueFiles,
        globallyUncoveredFiles: summary.uncoveredFiles,
      };
    }),
  };
}

function filterAgentIds(agentIds: readonly string[], selectedAgentId?: string): string[] {
  if (!selectedAgentId) {
    return [...agentIds];
  }

  if (!agentIds.includes(selectedAgentId)) {
    throw new Error(`Unknown agent id '${selectedAgentId}' in permission overlap report`);
  }

  return [...agentIds];
}

function buildFileRightCoverageSummary(
  right: Right,
  files: readonly FileRecord[],
  agentIds: readonly string[],
  ownershipByPath: Map<string, string[]>
): FileRightCoverageSummary {
  const uncoveredFiles: FileOwnershipEntry[] = [];
  const singlyOwnedFiles: FileOwnershipEntry[] = [];
  const overlappingFiles: FileOwnershipEntry[] = [];

  for (const file of files) {
    const owners = ownershipByPath.get(file.path) ?? [];
    if (owners.length === 0) {
      uncoveredFiles.push(toOwnershipEntry(file, owners));
      continue;
    }

    if (owners.length === 1) {
      singlyOwnedFiles.push(toOwnershipEntry(file, owners));
      continue;
    }

    overlappingFiles.push(toOwnershipEntry(file, owners));
  }

  return {
    right,
    totalFiles: files.length,
    uncoveredFiles,
    singlyOwnedFiles,
    overlappingFiles,
    agentResponsibilities: buildAgentResponsibilities(agentIds, files, ownershipByPath),
    pairs: buildPairOverlaps(agentIds, files, ownershipByPath),
  };
}

function buildOutsideDefaultContextByAgent(
  agentIds: readonly string[],
  files: readonly FileRecord[],
  rightsByAgent: Map<string, Map<string, Set<Right>>>
): AgentOutsideDefaultContextSummary[] {
  const defaultReadPathSet = new Set(files.map((file) => file.path));
  return agentIds.map((agentId) => ({
    agentId,
    rights: createRightRecord((right) => {
      const agentRights = rightsByAgent.get(agentId) ?? new Map<string, Set<Right>>();
      const outsideFiles = files
        .filter((file) => {
          const agentAllowed = agentRights.get(file.path)?.has(right) ?? false;
          const defaultAllowed = defaultReadPathSet.has(file.path);
          return agentAllowed && !defaultAllowed;
        })
        .map((file) => toOwnershipEntry(file, [agentId]));

      return {
        fileCount: outsideFiles.length,
        lineCount: outsideFiles.reduce((sum, file) => sum + file.lineCount, 0),
        files: outsideFiles,
      };
    }),
  }));
}

export async function loadAgentPermissionRules(workspaceRoot: string): Promise<AgentRuleMap> {
  const agentsDir = path.join(workspaceRoot, '.ai-team', 'agents');
  let entries: Dirent<string>[];

  try {
    entries = await readdir(agentsDir, { withFileTypes: true, encoding: 'utf8' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Map();
    }
    throw error;
  }

  const permFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.perm'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const rulesByAgent: AgentRuleMap = new Map();
  for (const fileName of permFiles) {
    const filePath = path.join(agentsDir, fileName);
    const content = await readFile(filePath, 'utf8');
    const agentId = path.basename(fileName, '.perm');
    const rules = parseAccessFile(content).map(normalizeRule);
    rulesByAgent.set(agentId, rules);
  }

  return rulesByAgent;
}

export async function analyzeWorkspacePermissionOverlap(
  workspaceRoot: string,
  options: AnalyzePermissionOverlapOptions = {},
  fileTypeGroupsFromConfig?: Record<string, FileTypeGroupConfig>
): Promise<PermissionOverlapReport> {
  const mode = options.mode ?? 'files';

  if (mode === 'patterns') {
    const rulesByAgent = await loadAgentPermissionRules(workspaceRoot);
    return buildPatternReport(analyzePermOverlap(rulesByAgent));
  }

  const fileTypeGroups = normalizeFileTypeGroups(fileTypeGroupsFromConfig);
  const agentManager = new AgentManager(
    workspaceRoot,
    new AgentDocumentStorage(
      workspaceRoot,
      new MarkdownSectionService(),
      new WorkspaceStorage(workspaceRoot),
      new WorkspaceDiscoveryStorage(workspaceRoot)
    ),
    new WorkspaceStorage(workspaceRoot),
    new WorkspaceDiscoveryStorage(workspaceRoot),
    new PermFileRegistry(workspaceRoot)
  );
  const permRegistry = new PermFileRegistry(workspaceRoot);
  const agents = await mergeAgentAccessPatterns(
    permRegistry,
    await agentManager.getAllAgentsAsync()
  );
  const agentIds = filterAgentIds(
    agents.map((agent) => agent.id).sort((a, b) => a.localeCompare(b)),
    options.agentId
  );

  const entries = await listWorkspaceFiles(workspaceRoot, {
    maxDepth: options.maxDepth ?? 20,
    filesOnly: true,
  });
  const files = await toFileRecords(entries);
  const filePaths = files.map((file) => file.path);

  /** Build a rights map for an agent across all file paths using resolved pattern contexts. */
  function buildRightsMap(agentId: string): Map<string, Set<Right>> {
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return new Map();

    const readPatterns = agent.permissions?.read ?? [];
    const writePatterns = agent.permissions?.write ?? [];
    if (readPatterns.length === 0 && writePatterns.length === 0) {
      return new Map();
    }

    const result = new Map<string, Set<Right>>();
    for (const fp of filePaths) {
      const rights = new Set<Right>();
      const canRead = readPatterns.some((pattern) => matchesPattern(fp, pattern));
      const canWrite = writePatterns.some((pattern) => matchesPattern(fp, pattern));
      if (canRead || canWrite) rights.add('list');
      if (canRead || canWrite) rights.add('read');
      if (canWrite) rights.add('write');
      if (rights.size > 0) result.set(fp, rights);
    }
    return result;
  }

  const rightsByAgent = new Map<string, Map<string, Set<Right>>>();
  for (const agent of agents) {
    rightsByAgent.set(agent.id, buildRightsMap(agent.id));
  }
  const rightsByAgentAllFiles = new Map<string, Map<string, Set<Right>>>();
  for (const agentId of agentIds) {
    rightsByAgentAllFiles.set(agentId, buildRightsMap(agentId));
  }
  const outsideDefaultContextByAgent = buildOutsideDefaultContextByAgent(
    agentIds,
    files,
    rightsByAgentAllFiles
  );

  const rights = createRightRecord((right) => {
    const ownershipByPath = new Map<string, string[]>();

    for (const file of files) {
      const owners = agentIds.filter(
        (agentId) => rightsByAgent.get(agentId)?.get(file.path)?.has(right) ?? false
      );
      ownershipByPath.set(file.path, owners);
    }

    return buildFileRightCoverageSummary(right, files, agentIds, ownershipByPath);
  });

  const report: FilePermissionOverlapReport = {
    kind: 'files',
    generatedAt: new Date().toISOString(),
    agentIds,
    workspaceFileCount: files.length,
    fileTypeGroups,
    rights,
    outsideDefaultContextByAgent,
  };

  if (options.agentId) {
    report.agentFocus = buildAgentFocus(options.agentId, rights);
  }

  return report;
}

export type {
  AgentRuleMap,
  SharedPatternOverlap,
  AgentRightSummary,
  PairwiseAgentOverlap,
  RightOverlapSummary,
} from 'fs-context';
