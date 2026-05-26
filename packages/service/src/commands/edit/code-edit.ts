import { ProposalStatus } from '@ai-team/core';

interface ProposalSummary {
  id: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

interface ListResult {
  proposals: ProposalSummary[];
  stats: unknown;
}

export class CodeEditService {
  constructor(private readonly manager: any) {}

  async listAsync({ status }: { status?: string } = {}): Promise<ListResult> {
    const proposals: any[] = status
      ? this.manager.getProposalsByStatus(
          ProposalStatus[status.toUpperCase() as keyof typeof ProposalStatus]
        )
      : this.manager.getAllProposals();

    return {
      proposals: proposals.map((p: any) => ({
        id: p.id,
        filesChanged: p.changes.length,
        additions: p.changes.reduce((sum: number, c: any) => sum + (c.diff?.additions ?? 0), 0),
        deletions: p.changes.reduce((sum: number, c: any) => sum + (c.diff?.deletions ?? 0), 0),
      })),
      stats: this.manager.getStatistics(),
    };
  }

  async rejectAsync(
    { proposalId }: { proposalId: string },
    { questionInput }: { questionInput: () => Promise<string> }
  ): Promise<{ proposalId: string }> {
    const reason = await questionInput();
    this.manager.rejectProposal(proposalId, reason);
    return { proposalId };
  }
}
