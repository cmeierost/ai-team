import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ICodeEditManager, ProposalStatus } from '@ai-team/core';
import { CodeEditService } from './code-edit.js';

const { managerMock } = vi.hoisted(() => {
  const proposals = [
    {
      id: 'proposal-1',
      agentName: 'agent-a',
      description: 'Update file',
      status: 'pending',
      timestamp: new Date('2026-01-01T00:00:00Z'),
      changes: [
        {
          filePath: 'src/a.ts',
          diff: { additions: 2, deletions: 1 },
        },
      ],
    },
    {
      id: 'proposal-2',
      agentName: 'agent-b',
      description: 'Refactor file',
      status: 'approved',
      timestamp: new Date('2026-01-02T00:00:00Z'),
      changes: [
        {
          filePath: 'src/b.ts',
          diff: { additions: 4, deletions: 3 },
        },
      ],
    },
  ];

  const managerMock = {
    getAllProposals: vi.fn().mockReturnValue(proposals),
    getProposalsByStatus: vi
      .fn()
      .mockImplementation((status: ProposalStatus) => proposals.filter((p) => p.status === status)),
    getProposal: vi
      .fn()
      .mockImplementation((proposalId: string) => proposals.find((p) => p.id === proposalId)),
    approveProposal: vi.fn(),
    rejectProposal: vi.fn(),
    applyProposal: vi.fn().mockResolvedValue(undefined),
    getStatistics: vi.fn().mockReturnValue({
      total: 2,
      pending: 1,
      approved: 1,
      rejected: 0,
      applied: 0,
      failed: 0,
    }),
  };

  return { managerMock };
});

describe('CodeEditService', () => {
  let service: CodeEditService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CodeEditService(managerMock as unknown as ICodeEditManager);
  });

  it('lists proposals and computes summaries', async () => {
    const result = await service.listAsync({});
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0]).toMatchObject({
      id: 'proposal-1',
      filesChanged: 1,
      additions: 2,
      deletions: 1,
    });
    expect(result.stats.total).toBe(2);
  });

  it('filters by status when listing', async () => {
    const result = await service.listAsync({ status: 'approved' });
    expect(managerMock.getProposalsByStatus).toHaveBeenCalledWith(ProposalStatus.APPROVED);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].id).toBe('proposal-2');
  });

  it('rejects with prompted reason when one is not provided', async () => {
    const result = await service.rejectAsync(
      { proposalId: 'proposal-1' },
      {
        questionInput: vi.fn().mockResolvedValue('Needs revision'),
      }
    );

    expect(managerMock.rejectProposal).toHaveBeenCalledWith('proposal-1', 'Needs revision');
    expect(result).toEqual({ proposalId: 'proposal-1' });
  });
});
