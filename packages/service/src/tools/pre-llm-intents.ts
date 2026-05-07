import { matchesFsTreePreLlmIntent } from './catalog/index.js';
import { matchesTeamListPreLlmIntent, matchesToolListPreLlmIntent } from './orchestration-tools.js';

export type PreLlmIntent = {
  kind: 'tool';
  toolName: 'tool_list' | 'fs_tree' | 'team_list';
  args: Record<string, unknown>;
};

/**
 * Central place for deterministic pre-LLM intent regexes that map user text
 * to tool/slash execution. Kept in service/tools so orchestration consumes a
 * tool-owned intent map rather than hardcoded regexes inside the orchestrator.
 */
export function resolvePreLlmIntent(message: string): PreLlmIntent | undefined {
  const trimmed = message.trim();
  if (!trimmed) return undefined;

  if (matchesToolListPreLlmIntent(trimmed)) {
    return {
      kind: 'tool',
      toolName: 'tool_list',
      args: {},
    };
  }

  if (matchesFsTreePreLlmIntent(trimmed)) {
    return {
      kind: 'tool',
      toolName: 'fs_tree',
      args: { path: '.', maxDepth: 6, includeHidden: true },
    };
  }

  if (matchesTeamListPreLlmIntent(trimmed)) {
    return {
      kind: 'tool',
      toolName: 'team_list',
      args: {},
    };
  }

  return undefined;
}
