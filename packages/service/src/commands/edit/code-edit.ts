import { type CodeEditProposal, type ICodeEditManager, ProposalStatus } from '@ai-team/core';

interface ProposalSummary {
  id: string;
  filesChanged: number;
  additions: number;
  deletions: number;
}

interface ListResult {
  proposals: ProposalSummary[];
  stats: ReturnType<ICodeEditManager['getStatistics']>;
}

export class CodeEditService {
  constructor(private readonly manager: ICodeEditManager) {}

  async listAsync({ status }: { status?: string } = {}): Promise<ListResult> {
    const proposals: CodeEditProposal[] = status
      ? this.manager.getProposalsByStatus(
          ProposalStatus[status.toUpperCase() as keyof typeof ProposalStatus]
        )
      : this.manager.getAllProposals();

    return {
      proposals: proposals.map((p) => ({
        id: p.id,
        filesChanged: p.changes.length,
        additions: p.changes.reduce((sum, c) => sum + (c.diff?.additions ?? 0), 0),
        deletions: p.changes.reduce((sum, c) => sum + (c.diff?.deletions ?? 0), 0),
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
