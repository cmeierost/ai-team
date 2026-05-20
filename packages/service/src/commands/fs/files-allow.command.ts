import { z } from 'zod';
import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import { FileTreeService, type PathMode } from './file-tree.js';
import type { IQuestionService } from '../../questions/question-service.js';
import { GovernanceService } from '../agents/governance.js';

type Params = z.infer<typeof FilesAllowCommand.schema>;
type Result = { paths: string[] };

export class FilesAllowCommand implements ICommand<Params, Result> {
  static readonly schema = z.object({
    path: z.string().describe('Path to allow'),
    agent: z.string().optional().describe('Scope to a specific agent'),
    requestedBy: z.string().optional().describe('Governance actor requesting the change'),
    approvedByUser: z.boolean().optional().describe('Mark user approval as granted'),
    mode: z.string().optional().describe('Permission mode: read | write'),
  });

  readonly key = 'filesAllow';
  readonly cli = { command: 'allow <path>', parentKey: 'files' };
  readonly description = 'Allow a path in file visibility (global config) or agent access rules';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'fs';
  readonly parameters = FilesAllowCommand.schema;

  constructor(
    private readonly fileTreeService: FileTreeService,
    private readonly questionService: IQuestionService,
    private readonly governanceService: GovernanceService
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<Result>> {
    const mode: PathMode =
      payload.mode === 'write' || payload.mode === 'create' || payload.mode === 'delete'
        ? 'write'
        : 'read';

    if (payload.agent) {
      const requestedBy = await this.governanceService.resolveRequestedByFromRuntime(
        ctx,
        payload.requestedBy,
        'requestedBy is required for agent governance'
      );
      const result = await this.fileTreeService.permissionAllow(
        payload.agent,
        payload.path,
        {
          requestedBy,
          confirmUserApproval: (msg: string) =>
            this.governanceService.confirmGovernanceActionFromRuntime(
              ctx,
              payload.approvedByUser,
              msg
            ),
        },
        mode
      );
      return { status: 'ok', data: { paths: result.paths } };
    }

    const paths = await this.fileTreeService.allowPath(payload.path, mode);
    return { status: 'ok', data: { paths } };
  }
}
