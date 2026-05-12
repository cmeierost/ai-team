import { z } from 'zod';
import type { HandoffRequest, ICommand, ExecutionContext } from '@ai-team/core';
import type { IAgentRegistry, ISessionGateway } from '../orchestration/orchestration.types.js';

type Params = z.infer<typeof HandoffCommand.schema>;

export class HandoffCommand {
  static readonly schema = z.object({
    targetAgentId: z.string().min(1).describe('ID of the agent to hand off to'),
    briefingNote: z
      .string()
      .min(1)
      .describe('Concise summary of the conversation and what the target agent needs to do.'),
  });

  readonly key = 'handoff';
  readonly description =
    'Transfer the current conversation to another agent who is better suited ' +
    'to handle the request. Use when a task is outside your area of responsibility. ' +
    'You must have delegation permission to the target agent.';
  readonly availableIn = { tool: true };
  readonly group = 'com';
  readonly parameters = HandoffCommand.schema;
  readonly permissionCheck = { type: 'agent-delegation' as const, argsPath: 'targetAgentId' };
  readonly tags = ['orchestration'];

  constructor(
    private readonly agents: IAgentRegistry,
    private readonly sessions: ISessionGateway
  ) {}

  async execute(params: Params, context: ExecutionContext): Promise<HandoffRequest> {
    const { targetAgentId, briefingNote } = params;

    const target =
      (await this.agents.getAgentAsync(targetAgentId)) ??
      (await this.agents.getAllAgentsAsync()).find((candidate) => {
        const query = targetAgentId.trim().toLowerCase();
        return (
          candidate.id.toLowerCase() === query ||
          candidate.name.toLowerCase() === query ||
          candidate.role.toLowerCase() === query
        );
      });

    if (!target) {
      throw new Error(
        `Agent not found: "${targetAgentId}". ` + 'Use who_should to discover valid agent IDs.'
      );
    }

    if (target.id === context.agent!!.id) {
      throw new Error('Cannot hand off to yourself. Choose another agent.');
    }

    const existingSession = await this.sessions.getLatestSession(target.id);

    return {
      type: 'handoff',
      targetAgentId: target.id,
      briefingNote,
      targetSessionId: existingSession?.id,
      timestamp: new Date().toISOString(),
    };
  }
}
