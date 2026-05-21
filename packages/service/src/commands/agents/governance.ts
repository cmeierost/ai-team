import type { Agent, IAgentManager, ExecutionContext } from '@ai-team/core';
import type { IInteractionService } from '../../questions/question-service.js';

export interface GovernanceRequest {
  /** Agent query (id/name) initiating the governance mutation. */
  requestedBy: string;
  /** Human approval callback. Must resolve true to proceed. */
  confirmUserApproval: (message: string) => Promise<boolean>;
}

export class GovernanceService {
  private static readonly DEFAULT_GOVERNANCE_ROLES = ['ceo', 'hr-director'];

  constructor(
    private readonly agentManager: IAgentManager,
    private readonly questionService: IInteractionService
  ) {}

  /**
   * Normalize a role string for comparison (lowercase, trimmed).
   */
  private normalizeRole(role: string): string {
    return role.trim().toLowerCase();
  }

  /**
   * Check if an agent has default governance authority (CEO or HR Director).
   */
  public isDefaultGovernanceActor(agent: Agent): boolean {
    const role = this.normalizeRole(agent.role);
    return GovernanceService.DEFAULT_GOVERNANCE_ROLES.includes(role);
  }

  /**
   * Resolve the governance actor for a given operation and requestor.
   */
  public async resolveGovernanceActor(requestedBy: string, operation: string): Promise<Agent> {
    const resolved = await this.agentManager.resolveAgentForOperationAsync(requestedBy, operation);
    const actor = await this.agentManager.getAgentAsync(resolved.id);
    if (!actor) {
      throw new Error(`Governance actor not found: ${resolved.id}`);
    }

    return actor;
  }

  /**
   * Assert that the actor has default governance policy rights.
   */
  public assertDefaultGovernancePolicy(actor: Agent): void {
    if (!this.isDefaultGovernanceActor(actor)) {
      throw new Error(
        `Permission governance denied for '${actor.id}' (${actor.role}). Only CEO and HR Director are allowed by default.`
      );
    }
  }

  /**
   * Require explicit user approval for a governance action.
   */
  public async requireUserApproval(request: GovernanceRequest, message: string): Promise<void> {
    const approved = await request.confirmUserApproval(message);
    if (!approved) {
      throw new Error('Permission governance denied by user approval.');
    }
  }

  /**
   * Resolve the requestedBy value from runtime context if not explicitly provided.
   * Falls back to interactive input via questionService.
   */
  public async resolveRequestedByFromRuntime(
    context: ExecutionContext,
    requestedBy: string | undefined,
    errorMessage: string
  ): Promise<string> {
    const explicit = requestedBy?.trim();
    if (explicit) return explicit;

    const response = await this.questionService.input({
      message: 'Requested by (must be CEO/HR):',
    });
    if (response.trim()) return response.trim();

    throw new Error(errorMessage);
  }

  /**
   * Confirm a governance action from runtime context.
   * Returns the explicit value if provided, otherwise prompts via questionService.
   */
  public async confirmGovernanceActionFromRuntime(
    context: ExecutionContext,
    approvedByUser: boolean | undefined,
    message: string
  ): Promise<boolean> {
    if (typeof approvedByUser === 'boolean') return approvedByUser;
    return this.questionService.confirm({ message, default: false });
  }
}
