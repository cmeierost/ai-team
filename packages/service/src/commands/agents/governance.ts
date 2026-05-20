import type { Agent, IAgentManager, ExecutionContext } from '@ai-team/core';
import type { IQuestionService } from '../../questions/question-service.js';

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
  const resolved = await agentManager.resolveAgentForOperationAsync(requestedBy, operation);
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

// ── ExecutionContext bridges for ICommand execute methods ───────────────────────

export async function resolveRequestedByFromRuntime(
  questionService: IQuestionService,
  context: ExecutionContext,
  requestedBy: string | undefined,
  errorMessage: string
): Promise<string> {
  const explicit = requestedBy?.trim();
  if (explicit) return explicit;
  const response = await questionService.input(
    { message: 'Requested by (must be CEO/HR):' },
    context
  );
  if (response.trim()) return response.trim();
  throw new Error(errorMessage);
}

export async function confirmGovernanceActionFromRuntime(
  questionService: IQuestionService,
  context: ExecutionContext,
  approvedByUser: boolean | undefined,
  message: string
): Promise<boolean> {
  if (typeof approvedByUser === 'boolean') return approvedByUser;
  return questionService.confirm({ message, default: false }, context);
}
