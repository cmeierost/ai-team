import type { Agent } from '@ai-team/core';
import { createContainer, TOKENS } from '../container/index.js';
import { resolveAgentForOperation } from '../utils/agent-resolution.js';

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
  workspaceRoot: string,
  requestedBy: string,
  operation: string,
): Promise<Agent> {
  const container = createContainer({ workspaceRoot });
  const agentManager = container.resolve(TOKENS.AgentManager);
  await agentManager.initialize();

  const resolved = resolveAgentForOperation(agentManager, requestedBy, operation);
  const actor = agentManager.getAgent(resolved.id);
  if (!actor) {
    throw new Error(`Governance actor not found: ${resolved.id}`);
  }

  return actor;
}

export function assertDefaultGovernancePolicy(actor: Agent): void {
  if (!isDefaultGovernanceActor(actor)) {
    throw new Error(
      `Permission governance denied for '${actor.id}' (${actor.role}). Only CEO and HR Director are allowed by default.`,
    );
  }
}

export async function requireUserApproval(
  request: GovernanceRequest,
  message: string,
): Promise<void> {
  const approved = await request.confirmUserApproval(message);
  if (!approved) {
    throw new Error('Permission governance denied by user approval.');
  }
}
