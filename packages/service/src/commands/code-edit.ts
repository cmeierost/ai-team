import type {
  CodeEditListResponse,
  CodeEditProposalSummary,
  InteractionContext,
} from '@ai-team/api-contracts';
import { type ICodeEditManager, ProposalStatus } from '@ai-team/core';

export interface ICodeEditManagerFactory {
  create(): ICodeEditManager;
}

export class CodeEditCommand {
  constructor(private readonly managerFactory: ICodeEditManagerFactory) {}

  async listAsync(payload: { status?: string; agent?: string }): Promise<CodeEditListResponse> {
    const manager = this.managerFactory.create();
    let proposals = manager.getAllProposals();

    if (payload.status) {
      const status = payload.status.toUpperCase() as ProposalStatus;
      proposals = manager.getProposalsByStatus(status);
    }

    if (payload.agent) {
      proposals = proposals.filter((p) => p.agentName === payload.agent);
    }

    const stats = manager.getStatistics();
    const summaries: CodeEditProposalSummary[] = proposals.map((p) => ({
      id: p.id,
      description: p.description,
      agentName: p.agentName,
      status: p.status,
      timestamp: p.timestamp instanceof Date ? p.timestamp.toISOString() : String(p.timestamp),
      filesChanged: p.changes.length,
      additions: p.changes.reduce((sum, c) => sum + c.diff.additions, 0),
      deletions: p.changes.reduce((sum, c) => sum + c.diff.deletions, 0),
      files: p.changes.map((c) => c.filePath),
    }));

    return { proposals: summaries, stats };
  }

  async approveAsync(payload: { proposalId: string }): Promise<{ proposalId: string }> {
    const manager = this.managerFactory.create();
    const proposal = manager.getProposal(payload.proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${payload.proposalId} not found`);
    }
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new Error(`Proposal ${payload.proposalId} is not pending (status: ${proposal.status})`);
    }
    manager.approveProposal(payload.proposalId);
    return { proposalId: payload.proposalId };
  }

  async rejectAsync(
    payload: { proposalId: string; reason?: string },
    context: InteractionContext = {}
  ): Promise<{ proposalId: string }> {
    const manager = this.managerFactory.create();
    const proposal = manager.getProposal(payload.proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${payload.proposalId} not found`);
    }
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new Error(`Proposal ${payload.proposalId} is not pending (status: ${proposal.status})`);
    }

    let reason = payload.reason;
    if (!reason && context.questionInput) {
      reason = await context.questionInput({
        message: 'Reason for rejection (optional):',
      });
    }

    manager.rejectProposal(payload.proposalId, reason || 'Rejected by user');
    return { proposalId: payload.proposalId };
  }

  async applyAsync(
    payload: { proposalId: string },
    context: InteractionContext = {}
  ): Promise<{ proposalId: string; files: string[] }> {
    const manager = this.managerFactory.create();
    const proposal = manager.getProposal(payload.proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${payload.proposalId} not found`);
    }
    if (proposal.status !== ProposalStatus.APPROVED) {
      throw new Error(
        `Proposal ${payload.proposalId} is not approved (status: ${proposal.status}). Approve it first.`
      );
    }

    if (context.questionConfirm) {
      const confirmed = await context.questionConfirm({
        message: `Apply ${proposal.changes.length} file change(s) from proposal ${payload.proposalId.substring(0, 12)}...?`,
        default: false,
      });
      if (!confirmed) {
        throw new Error('Operation cancelled by user');
      }
    }

    await manager.applyProposal(payload.proposalId);
    return {
      proposalId: payload.proposalId,
      files: proposal.changes.map((c) => c.filePath),
    };
  }
}

export async function codeEditListCommandAsync(
  _workspaceRoot: string,
  payload: { status?: string; agent?: string }
): Promise<CodeEditListResponse> {
  const { CodeEditManager } = await import('@ai-team/infrastructure');
  return new CodeEditCommand({ create: () => new CodeEditManager() }).listAsync(payload);
}

export async function codeEditApproveCommandAsync(
  _workspaceRoot: string,
  payload: { proposalId: string }
): Promise<{ proposalId: string }> {
  const { CodeEditManager } = await import('@ai-team/infrastructure');
  return new CodeEditCommand({ create: () => new CodeEditManager() }).approveAsync(payload);
}

export async function codeEditRejectCommandAsync(
  _workspaceRoot: string,
  payload: { proposalId: string; reason?: string },
  context: InteractionContext = {}
): Promise<{ proposalId: string }> {
  const { CodeEditManager } = await import('@ai-team/infrastructure');
  return new CodeEditCommand({ create: () => new CodeEditManager() }).rejectAsync(payload, context);
}

export async function codeEditApplyCommandAsync(
  _workspaceRoot: string,
  payload: { proposalId: string },
  context: InteractionContext = {}
): Promise<{ proposalId: string; files: string[] }> {
  const { CodeEditManager } = await import('@ai-team/infrastructure');
  return new CodeEditCommand({ create: () => new CodeEditManager() }).applyAsync(payload, context);
}
