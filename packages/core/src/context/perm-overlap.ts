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

export type {
  AgentRuleMap,
  SharedPatternOverlap,
  AgentRightSummary,
  PairwiseAgentOverlap,
  RightOverlapSummary,
} from 'fs-context';
