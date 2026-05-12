import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  IPermissionStorage,
  IConfigurationStorage,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import { permissionDenyCommand, disallowPathCommand, type PathMode } from './file-tree.js';
import {
  resolveRequestedByFromRuntime,
  confirmGovernanceActionFromRuntime,
} from '../agents/governance.js';

type Params = z.infer<typeof FilesDenyCommand.schema>;
type Result = { paths: string[] };

export class FilesDenyCommand implements ICommand<Params, Result> {
  static readonly schema = z.object({
    path: z.string().describe('Path to disallow'),
    agent: z.string().optional().describe('Scope to a specific agent'),
    requestedBy: z.string().optional().describe('Governance actor requesting the change'),
    approvedByUser: z.boolean().optional().describe('Mark user approval as granted'),
    mode: z.string().optional().describe('Permission mode: read | write'),
  });

  readonly key = 'filesDeny';
  readonly cli = { command: 'disallow <path>', parentKey: 'files' };
  readonly description =
    'Disallow a path from file visibility (global config) or agent access rules';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'fs';
  readonly parameters = FilesDenyCommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly permStorage: IPermissionStorage,
    private readonly configStorage: IConfigurationStorage
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<Result>> {
    const mode: PathMode =
      payload.mode === 'write' || payload.mode === 'create' || payload.mode === 'delete'
        ? 'write'
        : 'read';

    if (payload.agent) {
      const requestedBy = await resolveRequestedByFromRuntime(
        payload.requestedBy,
        ctx,
        'requestedBy is required for agent governance'
      );
      const result = await permissionDenyCommand(
        ctx.workspaceRoot,
        this.agents,
        this.permStorage,
        payload.agent,
        payload.path,
        {
          requestedBy,
          confirmUserApproval: (msg: string) =>
            confirmGovernanceActionFromRuntime(payload.approvedByUser, ctx, msg),
        },
        mode
      );
      return { status: 'ok', data: { paths: result.paths } };
    }

    const paths = await disallowPathCommand(
      ctx.workspaceRoot,
      this.configStorage,
      payload.path,
      mode
    );
    return { status: 'ok', data: { paths } };
  }
}
