import type { ApiDescription } from '@ts-http/core';

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

export interface AgentFocusedOverlapSummary {
  agentId: string;
  rights: Record<string, unknown>;
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
  right: string;
  totalFiles: number;
  uncoveredFiles: FileOwnershipEntry[];
  singlyOwnedFiles: FileOwnershipEntry[];
  overlappingFiles: FileOwnershipEntry[];
  agentResponsibilities: FileRightAgentResponsibility[];
  pairs: FileAgentPairOverlap[];
}

export interface FilePermissionOverlapReport {
  kind: 'files';
  generatedAt: string;
  agentIds: string[];
  workspaceFileCount: number;
  fileTypeGroups: Record<string, { label?: string; patterns?: string[]; extensions?: string[] }>;
  rights: Record<string, FileRightCoverageSummary>;
  outsideDefaultContextByAgent: Array<{ agentId: string; rights: Record<string, unknown> }>;
  agentFocus?: AgentFocusedOverlapSummary;
}

export interface RightOverlapSummary {
  right: string;
  agentIds: string[];
  sharedPatterns: Array<{ agentIds: string[]; pattern: string }>;
}

export interface PatternOverlapReport {
  kind: 'patterns';
  generatedAt: string;
  agentIds: string[];
  rights: Record<string, RightOverlapSummary>;
}

export type PermissionOverlapReport = FilePermissionOverlapReport | PatternOverlapReport;

export type FilePermission = 'read' | 'write' | 'list';

export interface WhoHasPermissionOptions {
  path: string;
  right?: FilePermission;
}

export interface PermissionContextCandidate {
  contextId: string;
  label?: string;
}

export interface DoIHavePermissionOptions {
  path: string;
  right?: FilePermission;
  agent?: string;
}

export interface DoIHavePermissionResponse {
  path: {
    input: string;
    absolute: string;
    relative: string;
  };
  right: FilePermission;
  contextId: string;
  contextLabel?: string;
  selectedBy: 'explicit' | 'default-first-agent';
  allowed: boolean;
  allRights: FilePermission[];
  explanation: string;
  alternativeContexts: Array<{ contextId: string; allowedPaths: string[] }>;
  deniedByIgnore: boolean;
  blockedByPatterns: string[];
}

export interface WhoHasPermissionResponse {
  path: {
    input: string;
    absolute: string;
    relative: string;
  };
  right: FilePermission;
  contextIds: string[];
  contexts: PermissionContextCandidate[];
  explanation: string;
}

export interface IAccessService {
  whoHasPermission(query: { path: string; right: string }): Promise<WhoHasPermissionResponse>;
  doIHavePermission(query: {
    path: string;
    right: string;
    agent: string;
  }): Promise<DoIHavePermissionResponse>;
  analyzeOverlap(query?: {
    mode?: string;
    agent?: string;
    maxDepth?: number;
  }): Promise<PermissionOverlapReport>;
}

export const accessDesc: ApiDescription<IAccessService> = {
  subRoute: '/api/access',
  mapping: {
    whoHasPermission: { method: 'GET', path: 'who' },
    doIHavePermission: { method: 'GET', path: 'can' },
    analyzeOverlap: { method: 'GET', path: 'overlap' },
  },
};
