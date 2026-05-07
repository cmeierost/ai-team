import type {
  CodeEditListResponse,
  CodeEditProposalSummary,
  InteractionContext,
} from '@ai-team/api-contracts';
import { type ICodeEditManager, ProposalStatus } from '@ai-team/core';

export class CodeEditService {
  constructor(private readonly manager: ICodeEditManager) {}

  async listAsync(payload: { status?: string; agent?: string }): Promise<CodeEditListResponse> {
    let proposals = this.manager.getAllProposals();

    if (payload.status) {
      const status = payload.status.toLowerCase() as ProposalStatus;
      proposals = this.manager.getProposalsByStatus(status);
    }

    if (payload.agent) {
      proposals = proposals.filter((p) => p.agentName === payload.agent);
    }

    const stats = this.manager.getStatistics();
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
    const proposal = this.manager.getProposal(payload.proposalId);
    if (!proposal) {
      throw new Error(`Proposal ${payload.proposalId} not found`);
    }
    if (proposal.status !== ProposalStatus.PENDING) {
      throw new Error(`Proposal ${payload.proposalId} is not pending (status: ${proposal.status})`);
    }
    this.manager.approveProposal(payload.proposalId);
    return { proposalId: payload.proposalId };
  }

  async rejectAsync(
    payload: { proposalId: string; reason?: string },
    context: InteractionContext = {}
  ): Promise<{ proposalId: string }> {
    const proposal = this.manager.getProposal(payload.proposalId);
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

    this.manager.rejectProposal(payload.proposalId, reason || 'Rejected by user');
    return { proposalId: payload.proposalId };
  }

  async applyAsync(
    payload: { proposalId: string },
    context: InteractionContext = {}
  ): Promise<{ proposalId: string; files: string[] }> {
    const proposal = this.manager.getProposal(payload.proposalId);
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

    await this.manager.applyProposal(payload.proposalId);
    return {
      proposalId: payload.proposalId,
      files: proposal.changes.map((c) => c.filePath),
    };
  }
}
