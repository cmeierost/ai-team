import { z } from 'zod';
import type {
  ICommand,
  TeamListResult,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';

import type { ScoredPreLlmIntentCandidate } from '../../tools/pre-llm-intents.js';
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

export class TeamListOrchestrationCommand implements ICommand<Params, TeamListResult> {
  static readonly schema = z.object({});

  readonly key = 'list';
  readonly description = 'List all team members with their IDs, names, and roles.';
  readonly availableIn = { tool: true };
  readonly group = 'team';
  readonly parameters = TeamListOrchestrationCommand.schema;
  readonly permissionCheck = { type: 'none' as const };
  readonly tags = ['orchestration'];

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
