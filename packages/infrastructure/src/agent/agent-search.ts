/**
 * Agent search primitive — shared ranked fuzzy matching used by both
 * AgentManager.resolveAgentAsync() and AgentManager.searchAgentsAsync().
 *
 * Isolating the algorithm here means:
 *  - The Levenshtein implementation is shared, not duplicated.
 *  - The 7-tier scoring logic lives in exactly one place.
 *  - Future improvements (embedding similarity, semantic search) touch only this file.
 */

import { type Agent, type AgentSearchOptions, type AgentSearchResult } from '@ai-team/core';
import { levenshtein } from '../utils/str.js';

export interface RankedAgentResult {
  agent: Agent;
  /** 0-100 relevance score. */
  score: number;
  /** Which fields contributed to the match. */
  matches: string[];
}

/**
 * Rank a list of agents against an optional free-text query.
 *
 * Scoring tiers (descending priority):
 *  100 – exact ID
 *   95 – exact name (case-insensitive)
 *   90 – exact role
 *   85 – partial name substring
 *   80 – partial ID substring
 *   75 – partial role substring
 *   70-75 – fuzzy full-name (Levenshtein ≤ 2)
 *   65-70 – fuzzy first-name (Levenshtein ≤ 2)
 *
 * Boosters (take the max, they never lower the base score):
 *  +specialization exact  → max(score, 70)
 *  +specialization partial → max(score, 60)
 *  +specialization fuzzy   → max(score, 55)
 *  +feature match          → max(score, 55)
 *  +tool exact             → max(score, 50)
 *  +tool partial           → max(score, 45)
 *  +markdown content       → max(score, 35-40)
 *
 * When `query` is empty/absent every agent receives score 50.
 */
export function rankAgents(query: string | undefined, agents: Agent[]): RankedAgentResult[] {
  if (!query || query.trim() === '') {
    return agents.map((agent) => ({ agent, score: 50, matches: [] }));
  }

  const q = query.toLowerCase().trim();
  const results: RankedAgentResult[] = [];

  for (const agent of agents) {
    let score = 0;
    const matches: string[] = [];

    // ── Base tier ────────────────────────────────────────────────────────────
    if (agent.id === q) {
      score = 100;
      matches.push('id');
    } else if (agent.name.toLowerCase() === q) {
      score = 95;
      matches.push('name');
    } else if (agent.role.toLowerCase() === q) {
      score = 90;
      matches.push('role');
    } else if (agent.name.toLowerCase().includes(q)) {
      score = 85;
      matches.push('name');
    } else if (agent.id.includes(q)) {
      score = 80;
      matches.push('id');
    } else if (agent.role.toLowerCase().includes(q)) {
      score = 75;
      matches.push('role');
    } else if (levenshtein(agent.name.toLowerCase(), q) <= 2) {
      score = 70 + (2 - levenshtein(agent.name.toLowerCase(), q)) * 2.5;
      matches.push('name');
    } else {
      const firstName = agent.name.toLowerCase().split(/\s+/)[0];
      if (levenshtein(firstName, q) <= 2) {
        score = 65 + (2 - levenshtein(firstName, q)) * 2.5;
        matches.push('name');
      }
    }

    // ── Boosters ─────────────────────────────────────────────────────────────
    if (agent.specializations) {
      for (const spec of agent.specializations) {
        const s = spec.toLowerCase();
        if (s === q) {
          score = Math.max(score, 70);
          if (!matches.includes('specializations')) matches.push('specializations');
        } else if (s.includes(q)) {
          score = Math.max(score, 60);
          if (!matches.includes('specializations')) matches.push('specializations');
        } else if (q.length > 3 && levenshtein(s, q) <= 2) {
          score = Math.max(score, 55);
          if (!matches.includes('specializations')) matches.push('specializations');
        }
      }
    }

    if (agent.features) {
      for (const feature of agent.features) {
        const f = feature.toLowerCase();
        if (f.includes(q) || q.includes(f)) {
          score = Math.max(score, 55);
          if (!matches.includes('features')) matches.push('features');
        }
      }
    }

    const agentTools = [...(agent.tools ?? []), ...(agent.cliTools ?? [])];
    for (const tool of agentTools) {
      const t = tool.toLowerCase();
      if (t === q) {
        score = Math.max(score, 50);
        if (!matches.includes('tools')) matches.push('tools');
      } else if (t.includes(q)) {
        score = Math.max(score, 45);
        if (!matches.includes('tools')) matches.push('tools');
      }
    }

    if (agent.markdown) {
      const c = agent.markdown.toLowerCase();
      if (c.includes(q)) {
        score = Math.max(score, q.length > 5 ? 40 : 35);
        if (!matches.includes('markdown')) matches.push('markdown');
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (score > 0) {
      results.push({ agent, score, matches });
    }
  }

  // Highest score first
  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Identity-only ranking for agent resolution and handoff detection.
 *
 * Only scores against id, name, and role — never against markdown content,
 * tools, features, or specializations. This prevents false positives where an
 * agent's document body mentions another agent's name (e.g. "reports to
 * Michael Brown") and makes that agent appear as a match.
 *
 * Scoring tiers (same as the base tier of rankAgents):
 *  100 – exact ID
 *   95 – exact name (case-insensitive)
 *   90 – exact role
 *   85 – partial name substring
 *   80 – partial ID substring
 *   75 – partial role substring
 *   70-75 – fuzzy full-name (Levenshtein ≤ 2)
 *   65-70 – fuzzy first-name (Levenshtein ≤ 2)
 */
export function rankAgentsByIdentity(
  query: string | undefined,
  agents: Agent[]
): RankedAgentResult[] {
  if (!query || query.trim() === '') {
    return agents.map((agent) => ({ agent, score: 50, matches: [] }));
  }

  const q = query.toLowerCase().trim();
  const results: RankedAgentResult[] = [];

  for (const agent of agents) {
    let score = 0;
    const matches: string[] = [];

    if (agent.id === q) {
      score = 100;
      matches.push('id');
    } else if (agent.name.toLowerCase() === q) {
      score = 95;
      matches.push('name');
    } else if (agent.role.toLowerCase() === q) {
      score = 90;
      matches.push('role');
    } else if (agent.name.toLowerCase().includes(q)) {
      score = 85;
      matches.push('name');
    } else if (agent.id.includes(q)) {
      score = 80;
      matches.push('id');
    } else if (agent.role.toLowerCase().includes(q)) {
      score = 75;
      matches.push('role');
    } else if (levenshtein(agent.name.toLowerCase(), q) <= 2) {
      score = 70 + (2 - levenshtein(agent.name.toLowerCase(), q)) * 2.5;
      matches.push('name');
    } else {
      const firstName = agent.name.toLowerCase().split(/\s+/)[0];
      if (levenshtein(firstName, q) <= 2) {
        score = 65 + (2 - levenshtein(firstName, q)) * 2.5;
        matches.push('name');
      }
    }

    if (score > 0) {
      results.push({ agent, score, matches });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

/**
 * Apply the structural filters from AgentSearchOptions, then call rankAgents().
 * This is the full implementation backing AgentManager.searchAgentsAsync().
 */
export function filterAndRankAgents(
  options: AgentSearchOptions,
  agents: Agent[]
): AgentSearchResult[] {
  let filtered = agents;

  if (options.role) {
    const roles = Array.isArray(options.role) ? options.role : [options.role];
    filtered = filtered.filter((a) => roles.some((r) => a.role.toLowerCase() === r.toLowerCase()));
  }
  if (options.type) {
    const types = Array.isArray(options.type) ? options.type : [options.type];
    filtered = filtered.filter((a) => a.type && types.includes(a.type));
  }
  if (options.status) {
    const statuses = Array.isArray(options.status) ? options.status : [options.status];
    filtered = filtered.filter((a) => a.status && statuses.includes(a.status));
  }
  if (options.contextLevel) {
    const levels = Array.isArray(options.contextLevel)
      ? options.contextLevel
      : [options.contextLevel];
    filtered = filtered.filter((a) => levels.includes(a.contextLevel));
  }
  if (options.feature) {
    const features = Array.isArray(options.feature) ? options.feature : [options.feature];
    filtered = filtered.filter((a) => a.features && features.some((f) => a.features!.includes(f)));
  }
  if (options.specialization) {
    const specs = Array.isArray(options.specialization)
      ? options.specialization
      : [options.specialization];
    filtered = filtered.filter(
      (a) =>
        a.specializations &&
        specs.some((s) =>
          a.specializations!.some((as) => as.toLowerCase().includes(s.toLowerCase()))
        )
    );
  }
  if (options.tool) {
    const tools = Array.isArray(options.tool) ? options.tool : [options.tool];
    filtered = filtered.filter((a) => {
      const agentTools = [...(a.tools ?? []), ...(a.cliTools ?? [])];
      return tools.some((t) => agentTools.some((at) => at.toLowerCase().includes(t.toLowerCase())));
    });
  }
  if (options.reportsTo !== undefined) {
    filtered = filtered.filter((a) => a.reportsTo === options.reportsTo);
  }

  return rankAgents(options.query, filtered);
}
