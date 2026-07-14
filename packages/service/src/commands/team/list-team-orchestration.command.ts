import { z } from 'zod';
import type {
  ICommand,
  TeamListResult,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';

import type { ScoredPreLlmIntentCandidate } from '../../interaction/intents/pre-llm-intents.js';
import type { IAgentRegistry } from '../orchestration/orchestration.types.js';

export const TEAM_LIST_PRE_LLM_PATTERNS: readonly RegExp[] = [
  /\b(what|which|list|show)\b.*\b(employee|employees|agent|agents|team|teammates|team members)\b/i,
  /\bwho\b.*\b(employee|employees|agent|agents|team|teammates|team members)\b/i,
  /\bwho\s+is\s+on\s+the\s+team\b/i,
  /\bshow\s+all\s+(agents|employees|team members)\b/i,
  /\blist\s+(all\s+)?(agents|employees|team members)\b/i,
];

export function matchesTeamListPreLlmIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return TEAM_LIST_PRE_LLM_PATTERNS.some((pattern) => pattern.test(text));
}

type Params = z.infer<typeof TeamListOrchestrationCommand.schema>;
const _teamListOrchestrationCommandSchema = z.object({});

export const TeamListOrchestrationCommandMetadata = {
  key: 'list',
  description: 'List all team members with their IDs, names, and roles.',
  availableIn: { tool: true },
  group: 'team',
  parameters: _teamListOrchestrationCommandSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration'],
} satisfies ICommandDescriptor;

export class TeamListOrchestrationCommand implements ICommand<Params, TeamListResult> {
  static readonly schema = _teamListOrchestrationCommandSchema;
  readonly metadata = TeamListOrchestrationCommandMetadata;

  constructor(private readonly agents: IAgentRegistry) {}

  readonly scorePreLlmIntent = (
    message: string,
    _ctx: ExecutionContext
  ): ScoredPreLlmIntentCandidate | undefined => {
    const text = message.trim();
    if (!text) return undefined;

    if (matchesTeamListPreLlmIntent(text)) {
      return {
        kind: 'tool',
        toolName: 'team_list',
        args: {},
        score: 100,
        reason: 'Explicit team roster request.',
      };
    }

    if (/\b(team|agents|employees|teammates|roster)\b/i.test(text)) {
      return {
        kind: 'tool',
        toolName: 'team_list',
        args: {},
        score: 72,
        reason: 'Likely request for team roster.',
      };
    }

    return undefined;
  };

  async execute(
    _params: Params,
    _context: ExecutionContext
  ): Promise<CommandResponse<TeamListResult>> {
    const members = await this.agents.getAllAgentsAsync();

    return {
      status: 'ok',
      data: {
        type: 'team_list_result',
        members: members.map((agent) => ({
          agentId: agent.id,
          agentName: agent.name,
          agentRole: agent.role,
        })),
        timestamp: new Date().toISOString(),
      },
    };
  }
}
