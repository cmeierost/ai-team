import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { UpdateAgentToolResponse } from '@ai-team/api-contracts';
import type { ToolManager } from '../../tools/tool-manager.js';
import type { IQuestionService } from '../../questions/question-service.js';
import { toolDenyCommand } from './tools.js';
import {
  resolveRequestedByFromRuntime,
  confirmGovernanceActionFromRuntime,
} from '../agents/governance.js';

type Params = z.infer<typeof ToolsDenyCommand.schema>;

export class ToolsDenyCommand implements ICommand<Params, UpdateAgentToolResponse> {
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
    private readonly toolManager: ToolManager,
    private readonly questionService: IQuestionService
  ) {}

  async execute(
    payload: Params,
    ctx: ExecutionContext
  ): Promise<CommandResponse<UpdateAgentToolResponse>> {
    const requestedBy = await resolveRequestedByFromRuntime(
      this.questionService,
      ctx,
      payload.requestedBy,
      'requestedBy is required for tool governance'
    );
    const data = await toolDenyCommand(
      this.agents,
      this.toolManager,
      { agent: payload.agent, tool: payload.tool },
      {
        requestedBy,
        confirmUserApproval: (msg: string) =>
          confirmGovernanceActionFromRuntime(
            this.questionService,
            ctx,
            payload.approvedByUser,
            msg
          ),
      }
    );
    return { status: 'ok', data };
  }
}
