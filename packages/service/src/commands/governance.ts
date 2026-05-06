import type { Agent, IAgentManager } from '@ai-team/core';
import { resolveAgentForOperationAsync } from '../utils/agent-resolution.js';

export interface GovernanceRequest {
  /** Agent query (id/name) initiating the governance mutation. */
  requestedBy: string;
  /** Human approval callback. Must resolve true to proceed. */
  confirmUserApproval: (message: string) => Promise<boolean>;
}

function normalizeRole(role: string): string {
  return role.trim().toLowerCase();
}

export function isDefaultGovernanceActor(agent: Agent): boolean {
  const role = normalizeRole(agent.role);
  return role === 'ceo' || role === 'hr-director';
}

export async function resolveGovernanceActor(
  agentManager: IAgentManager,
  requestedBy: string,
  operation: string
): Promise<Agent> {
  const resolved = await resolveAgentForOperationAsync(agentManager, requestedBy, operation);
  const actor = await agentManager.getAgentAsync(resolved.id);
  if (!actor) {
    throw new Error(`Governance actor not found: ${resolved.id}`);
  }

  return actor;
}

export function assertDefaultGovernancePolicy(actor: Agent): void {
  if (!isDefaultGovernanceActor(actor)) {
    throw new Error(
      `Permission governance denied for '${actor.id}' (${actor.role}). Only CEO and HR Director are allowed by default.`
    );
  }
}

export async function requireUserApproval(
  request: GovernanceRequest,
  message: string
): Promise<void> {
  const approved = await request.confirmUserApproval(message);
  if (!approved) {
    throw new Error('Permission governance denied by user approval.');
  }
}
