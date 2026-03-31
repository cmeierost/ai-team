import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  analyzePermOverlap,
  parseAccessFile,
  type AccessRule,
  type AgentRuleMap,
  type PermissionOverlapReport,
  type SharedPatternOverlap,
  type AgentRightSummary,
  type PairwiseAgentOverlap,
  type RightOverlapSummary,
} from '@ai-team/permission';

function normalizePermPattern(pattern: string): string {
  return pattern.replaceAll('\\', '/').trim();
}

function normalizeRule(rule: AccessRule): AccessRule {
  return {
    ...rule,
    pathPattern: normalizePermPattern(rule.pathPattern),
  };
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

export async function analyzeWorkspacePermissionOverlap(workspaceRoot: string): Promise<PermissionOverlapReport> {
  const rulesByAgent = await loadAgentPermissionRules(workspaceRoot);
  return analyzePermOverlap(rulesByAgent);
}

export type {
  AgentRuleMap,
  PermissionOverlapReport,
  SharedPatternOverlap,
  AgentRightSummary,
  PairwiseAgentOverlap,
  RightOverlapSummary,
};
