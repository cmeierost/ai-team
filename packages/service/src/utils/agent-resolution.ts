import type { AgentManager } from '@ai-team/core';
import { AgentNotFoundError } from '@ai-team/core';
import { AmbiguousAgentQueryError } from '../errors.js';

/**
 * Resolves an agent query using fuzzy matching with consistent error handling
 * @param agentManager - The AgentManager instance
 * @param query - Agent ID, role, name, or partial match
 * @param operation - Description of the operation for error messages
 * @returns The resolved agent
 * @throws {AgentNotFoundError} If no agent matches the query
 * @throws {AmbiguousAgentQueryError} If multiple agents match the query
 */
export function resolveAgentForOperation(
  agentManager: AgentManager,
  query: string,
  operation: string,
): { id: string; name: string; role: string } {
  const matches = agentManager.resolveAgent(query);

  if (matches.length === 0) {
    // Generate suggestions for similar agents
    const allAgents = agentManager.getAllAgents();
    const suggestions = allAgents
      .slice(0, 10) // Limit to 10 suggestions
      .map(a => ({ id: a.id, name: a.name, role: a.role }));
    
    throw new AgentNotFoundError(
      `Cannot ${operation}: Agent not found for query "${query}". ` +
      `Available agents: ${suggestions.map(s => s.name).join(', ')}`
    );
  }

  if (matches.length > 1) {
    // Multiple matches - require user to be more specific
    const matchData = matches.map(m => ({ id: m.id, name: m.name, role: m.role }));
    throw new AmbiguousAgentQueryError(query, matchData);
  }

  // Single match - return it
  const agent = matches[0];
  return { id: agent.id, name: agent.name, role: agent.role };
}

/**
 * Resolves an agent query, returning null if not found (no exceptions)
 * @param agentManager - The AgentManager instance
 * @param query - Agent ID, role, name, or partial match
 * @returns The resolved agent or null
 */
export function resolveAgentSafe(
  agentManager: AgentManager | undefined,
  query: string,
): { id: string; name: string; role: string } | null {
  if (!agentManager) {
    return null;
  }

  const matches = agentManager.resolveAgent(query);
  
  if (matches.length === 1) {
    const agent = matches[0];
    return { id: agent.id, name: agent.name, role: agent.role };
  }

  return null;
}
