import { z } from 'zod';
import type { ICommand, ICodeEditManager, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { CodeEditListResponse, CodeEditProposalSummary } from '@ai-team/api-contracts';
import { ProposalStatus } from '@ai-team/core';

type ListParams = z.infer<typeof CodeEditListCommand.schema>;

export class CodeEditListCommand implements ICommand<ListParams, CodeEditListResponse> {
  static readonly schema = z.object({
    status: z.string().optional().describe('Optional proposal status filter'),
    agent: z.string().optional().describe('Optional agent name filter'),
  });

  readonly key = 'codeEditList';
  readonly cli = { command: 'code-edit list' };
  readonly description = 'List code edit proposals';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'edit';
  readonly parameters = CodeEditListCommand.schema;

  constructor(private readonly manager: ICodeEditManager) {}

  async execute(
    payload: ListParams,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<CodeEditListResponse>> {
    let proposals = this.manager.getAllProposals();

    if (payload.status) {
      proposals = this.manager.getProposalsByStatus(payload.status.toLowerCase() as ProposalStatus);
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

    return { status: 'ok', data: { proposals: summaries, stats } };
  }
}
