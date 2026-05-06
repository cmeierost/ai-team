/**
 * Agent selection utilities — pure logic, no I/O dependencies.
 *
 * Lives in service/utils alongside agent-resolution.ts so any caller
 * (orchestrator, CLI, VS Code, API server) can use it without importing
 * from a chat-specific module.
 */
import { type Agent, RoleType } from '@ai-team/core';

/**
 * Select the best top-level agent when none is explicitly specified.
 * Prefers executive > leadership > team lead > IC, then role naming heuristics,
 * then creation date, then alphabetical id.
 */
export function selectDefaultTopAgent(agents: Agent[]): Agent | undefined {
  if (agents.length === 0) return undefined;

  const ids = new Set(agents.map((a) => a.id));
  const roots = agents.filter((a) => !a.reportsTo || !ids.has(a.reportsTo));
  const candidates = roots.length > 0 ? roots : agents;

  const rankType = (a: Agent): number => {
    switch (a.type) {
      case RoleType.EXECUTIVE:
        return 0;
      case RoleType.LEADERSHIP:
        return 1;
      case RoleType.TEAM_LEAD:
        return 2;
      case RoleType.INDIVIDUAL_CONTRIBUTOR:
        return 3;
      default:
        return 4;
    }
  };

  const rolePriority = (role: string): number => {
    const n = role.toLowerCase();
    if (n === 'cto' || n.includes('chief-architect') || n.includes('chief architect')) return 0;
    if (n.includes('head') || n.includes('director')) return 1;
    return 2;
  };

  return [...candidates].sort((a, b) => {
    const typeDelta = rankType(a) - rankType(b);
    if (typeDelta !== 0) return typeDelta;
    const roleDelta = rolePriority(a.role) - rolePriority(b.role);
    if (roleDelta !== 0) return roleDelta;
    const ca = Date.parse(a.createdAt || '');
    const cb = Date.parse(b.createdAt || '');
    if (!Number.isNaN(ca) && !Number.isNaN(cb) && ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  })[0];
}

/** Format the interactive input prompt shown to the developer. */
export function formatUserPrompt(agent: Agent, developerName?: string | null): string {
  return `${developerName || 'You'} → ${agent.name} (${agent.role}):`;
}

/** Extract the developer's display name from user-env vars. */
export function resolveDeveloperName(env: Record<string, string>): string | undefined {
  return (
    env['AI_TEAM_USER_NAME']?.trim() ||
    env['AI_TEAM_USER']?.trim() ||
    env['AI_TEAM_DEVELOPER']?.trim()
  );
}
