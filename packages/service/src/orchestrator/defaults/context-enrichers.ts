/**
 * Context enrichers — IContextEnricher implementations that inject role-aware
 * system message content before each LLM call.
 *
 * Each enricher checks the agent's role / contextLevel and returns a string
 * payload or null (skip). The orchestrator concatenates non-null results.
 *
 * Built-in enrichers:
 *   WorkspaceOverviewEnricher — injects a directory tree for architect/leadership agents
 *   TeamRosterEnricher        — injects active team list for HR-role agents
 *
 * Adding a new enricher: implement IContextEnricher, pass via plugins.enrichers[].
 */

import { promises as fs } from 'fs';
import path from 'path';
import { ContextLevel } from '@ai-team/infrastructure';
import type { IContextEnricher } from '../pipeline.js';
import type { OrchestratorContext } from '../pipeline-context.js';

// ── Workspace Overview ────────────────────────────────────────────────────────

const ARCHITECT_ROLES = ['architect', 'tech-lead', 'engineering-manager', 'cto', 'vp-engineering'];

export class WorkspaceOverviewEnricher implements IContextEnricher {
  readonly name = 'workspace-overview';

  async enrich(ctx: OrchestratorContext): Promise<string | null> {
    const role = ctx.agent.role.toLowerCase();
    const isHighContextAgent =
      ARCHITECT_ROLES.some(r => role.includes(r)) ||
      ctx.agent.contextLevel === ContextLevel.ORGANIZATION ||
      ctx.agent.contextLevel === ContextLevel.REPOSITORY;

    if (!isHighContextAgent) return null;

    try {
      const tree = await buildDirectoryTree(ctx.workspaceRoot, 3);
      return `## Current workspace structure\n\`\`\`\n${tree}\n\`\`\``;
    } catch {
      return null;
    }
  }
}

// ── Team Roster ───────────────────────────────────────────────────────────────

const HR_ROLES = ['hr', 'people-ops', 'recruiter', 'team-lead', 'manager', 'director'];

export class TeamRosterEnricher implements IContextEnricher {
  readonly name = 'team-roster';

  async enrich(ctx: OrchestratorContext): Promise<string | null> {
    const role = ctx.agent.role.toLowerCase();
    const isHrRole = HR_ROLES.some(r => role.includes(r));

    if (!isHrRole) return null;

    const agents = (await ctx.agentManager.getAllAgentsAsync()).filter(a => a.id !== ctx.agent.id);
    if (agents.length === 0) return null;

    const lines = agents.map(a => `- **${a.name}** (${a.role}) [${a.id}]${a.status ? ` — ${a.status}` : ''}`);
    return `## Current team roster\n${lines.join('\n')}`;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function buildDirectoryTree(dir: string, maxDepth: number, depth = 0): Promise<string> {
  if (depth >= maxDepth) return '';

  const IGNORE = new Set(['.git', 'node_modules', '.ai-team', 'dist', '.next', 'coverage', '.turbo']);
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  let entries: { name: string; isDir: boolean }[] = [];
  try {
    const raw = await fs.readdir(dir, { withFileTypes: true });
    entries = raw
      .filter(e => !IGNORE.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(e => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return '';
  }

  for (const entry of entries.slice(0, 25)) {
    if (entry.isDir) {
      lines.push(`${indent}${entry.name}/`);
      const subtree = await buildDirectoryTree(path.join(dir, entry.name), maxDepth, depth + 1);
      if (subtree) lines.push(subtree);
    } else {
      lines.push(`${indent}${entry.name}`);
    }
  }

  if (entries.length > 25) lines.push(`${indent}… (${entries.length - 25} more)`);
  return lines.join('\n');
}
