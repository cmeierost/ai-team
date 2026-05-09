import { z } from 'zod';
import type { ICommand, CommandRuntime, IAgentManager } from '@ai-team/core';
import type { UpdateAgentToolResponse } from '@ai-team/api-contracts';
import type { ToolManager } from '../../tools/tool-manager.js';
import { toolDenyCommand } from './tools.js';
import {
  resolveRequestedByFromRuntime,
  confirmGovernanceActionFromRuntime,
} from '../agents/governance.js';

type Params = z.infer<typeof ToolsDenyCommand.schema>;

export class ToolsDenyCommand implements ICommand<Params, void, UpdateAgentToolResponse> {
  static readonly schema = z.object({
    agent: z.string().describe('Agent id, name, or role query'),
    tool: z.string().describe('Tool name to disallow'),
    requestedBy: z.string().optional().describe('Governance actor requesting the change'),
    approvedByUser: z.boolean().optional().describe('Mark user approval as granted'),
    json: z.boolean().optional().describe('Output as JSON'),
  });

  readonly key = 'toolsDeny';
  readonly aliases = ['remove'];
  readonly cli = { command: 'disallow', parentKey: 'tools' };
  readonly description = 'Disallow a tool for an agent (governed)';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'tool';
  readonly parameters = ToolsDenyCommand.schema;

  constructor(
    private readonly agents: IAgentManager,
    private readonly toolManager: ToolManager
  ) {}

  async execute(
    payload: Params,
    _ctx: void,
    runtime: CommandRuntime
  ): Promise<UpdateAgentToolResponse> {
    const requestedBy = await resolveRequestedByFromRuntime(
      payload.requestedBy,
      runtime,
      'requestedBy is required for tool governance'
    );
    return toolDenyCommand(
      this.agents,
      this.toolManager,
      { agent: payload.agent, tool: payload.tool },
      {
        requestedBy,
        confirmUserApproval: (msg: string) =>
          confirmGovernanceActionFromRuntime(payload.approvedByUser, runtime, msg),
      }
    );
  }
}
