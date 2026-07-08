import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import { FileTreeService, type PathMode } from './file-tree.js';
import { GovernanceService } from '../../governance/governance-service.js';

type Params = z.infer<typeof FilesAllowCommand.schema>;
type Result = { paths: string[] };
const _filesAllowCommandSchema = z.object({
  path: z.string().describe('Path to allow'),
  agent: z.string().optional().describe('Scope to a specific agent'),
  requestedBy: z.string().optional().describe('Governance actor requesting the change'),
  approvedByUser: z.boolean().optional().describe('Mark user approval as granted'),
  mode: z.string().optional().describe('Permission mode: read | write'),
});

export const FilesAllowCommandMetadata = {
  key: 'allow',
  description: 'Allow a path in file visibility (global config) or agent access rules',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'fs',
  parameters: _filesAllowCommandSchema,
} satisfies ICommandDescriptor;

export class FilesAllowCommand implements ICommand<Params, Result> {
  static readonly schema = _filesAllowCommandSchema;
  readonly metadata = FilesAllowCommandMetadata;

  constructor(
    private readonly fileTreeService: FileTreeService,
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
