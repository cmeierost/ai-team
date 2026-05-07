import { z } from 'zod';
import type {
  ICommand,
  CommandRuntime,
  IAgentManager,
  IPermissionStorage,
  IConfigurationStorage,
} from '@ai-team/core';
import { permissionAllowCommand, allowPathCommand, type PathMode } from './file-tree.js';
import {
  resolveRequestedByFromRuntime,
  confirmGovernanceActionFromRuntime,
} from '../agents/governance.js';

type Params = z.infer<typeof FilesAllowCommand.schema>;
type Result = { paths: string[] };

export class FilesAllowCommand implements ICommand<Params, void, Result> {
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
  readonly parameters = FilesAllowCommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly permStorage: IPermissionStorage,
    private readonly configStorage: IConfigurationStorage
  ) {}

  async execute(payload: Params, _ctx: void, runtime: CommandRuntime): Promise<Result> {
    const mode: PathMode =
      payload.mode === 'write' || payload.mode === 'create' || payload.mode === 'delete'
        ? 'write'
        : 'read';

    if (payload.agent) {
      const requestedBy = await resolveRequestedByFromRuntime(
        payload.requestedBy,
        runtime,
        'requestedBy is required for agent governance'
      );
      const result = await permissionAllowCommand(
        runtime.workspaceRoot,
        this.agents,
        this.permStorage,
        payload.agent,
        payload.path,
        {
          requestedBy,
          confirmUserApproval: (msg: string) =>
            confirmGovernanceActionFromRuntime(payload.approvedByUser, runtime, msg),
        },
        mode
      );
      return { paths: result.paths };
    }

    const paths = await allowPathCommand(
      runtime.workspaceRoot,
      this.configStorage,
      payload.path,
      mode
    );
    return { paths };
  }
}
