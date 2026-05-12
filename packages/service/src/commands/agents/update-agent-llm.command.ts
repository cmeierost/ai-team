import { z } from 'zod';
import type { ICommand, ExecutionContext, CommandResponse, IAgentDocumentStorage, IAgentManager } from '@ai-team/core';

// ─── UpdateEmployeeLlm ────────────────────────────────────────────────────────

const updateEmployeeLlmSchema = z.object({
  agentId: z.string().min(1).describe('Target employee name/id/role'),
  provider: z.string().optional(),
  modelKey: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  topP: z.number().optional(),
  presencePenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  stop: z.array(z.string()).optional(),
});

export type UpdateEmployeeLlmParams = z.infer<typeof updateEmployeeLlmSchema>;

export interface UpdateEmployeeLlmResult {
  employee: string;
  llm: Record<string, unknown>;
  persisted: boolean;
}

export class UpdateEmployeeLlmTool implements ICommand<
  UpdateEmployeeLlmParams,
  UpdateEmployeeLlmResult
> {
  constructor(
    private readonly agentManager: IAgentManager,
    private readonly agentDocumentStorage: IAgentDocumentStorage
  ) {}

  readonly name = 'update_llm';
  readonly key = 'update_llm';
  readonly group = 'hr';
  readonly availableIn = { tool: true };
  readonly description =
    "Update another employee's LLM profile (model, provider, and generation params).";
  readonly parameters = updateEmployeeLlmSchema;

  async execute(
    params: UpdateEmployeeLlmParams,
    context: ExecutionContext
  ): Promise<CommandResponse<UpdateEmployeeLlmResult>> {
    const {
      agentId,
      provider,
      modelKey,
      model,
      baseUrl,
      temperature,
      maxTokens,
      topP,
      presencePenalty,
      frequencyPenalty,
      stop,
    } = params;

    // Resolve target agent
    const matches = await this.agentManager.resolveAgentAsync(agentId.trim());
    if (matches.length === 0) throw new Error(`No employee found matching '${agentId}'.`);
    if (matches.length > 1) {
      return {
        status: 'error',
        message: `Multiple employees match '${agentId}'. Please be more specific.`,
        error: {
          code: 'MULTIPLE_AGENTS_FOUND',
          message: `Multiple employees match '${agentId}'. Please be more specific.`,
          details: { matches: matches.map((a) => ({ id: a.id, name: a.name })) },
        },
      };
    }
    const target = matches[0];

    // Humans can always call this (slash command or otherwise).
    // Agents reaching this point via the tool surface are already authorized by the tool
    // registry — no further restriction needed.
    if (!context.calledByHuman) {
      const caller = context.agent;
      if (!caller) {
        return {
          status: 'error',
          message: `No caller agent in context.`,
          error: { code: 'AGENT_NOT_FOUND', message: `No caller agent in context.` },
        };
      }
      const canManage = caller.contextLevel === 'organization';
      const isManager = target.reportsTo === caller.id;
      const isSelf = target.id === caller.id;
      const hasToolAccess = context.invocationSurface === 'tool';
      if (!canManage && !isManager && !isSelf && !hasToolAccess) {
        return {
          status: 'error',
          message: `Agent ${caller.id} cannot update LLM settings for ${target.id}.`,
          error: {
            code: 'PERMISSION_DENIED',
            message: `Agent ${caller.id} cannot update LLM settings for ${target.id}.`,
            details: { attemptedUpdateFor: target.id, params },
          },
        };
      }
    }

    const record = await this.agentDocumentStorage.loadAgentAsync(target.filePath);
    const currentProfile = record.llm || {};
    const currentParams = (currentProfile as any).params || {};

    const nextParams = {
      ...currentParams,
      ...(temperature === undefined ? {} : { temperature }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(topP === undefined ? {} : { topP }),
      ...(presencePenalty === undefined ? {} : { presencePenalty }),
      ...(frequencyPenalty === undefined ? {} : { frequencyPenalty }),
      ...(stop === undefined ? {} : { stop }),
    };

    const nextProfile = {
      ...currentProfile,
      ...(provider === undefined ? {} : { provider }),
      ...(modelKey === undefined ? {} : { modelKey }),
      ...(model === undefined ? {} : { model }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
      params: Object.keys(nextParams).length > 0 ? nextParams : undefined,
    };

    record.llm = nextProfile;
    await this.agentDocumentStorage.saveAgentAsync(record);

    return {
      status: 'ok',
      message: `LLM profile updated for employee ${target.id}`,
      data: { employee: target.id, llm: nextProfile, persisted: true },
    };
  }
}
