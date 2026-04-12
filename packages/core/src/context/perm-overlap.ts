import { type RightOverlapSummary } from 'fs-context';
import type { Right, FileTypeGroupConfig } from '../types/index.js';

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

export type {
  AgentRuleMap,
  SharedPatternOverlap,
  AgentRightSummary,
  PairwiseAgentOverlap,
  RightOverlapSummary,
} from 'fs-context';
