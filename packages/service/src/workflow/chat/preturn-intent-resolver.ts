import type { Agent, ExecutionContext, ICommand } from '@ai-team/core';

export interface WorkflowAskChoice {
  name: string;
  value: string;
  description?: string;
  recommended?: boolean;
}

export interface WorkflowAskSpec {
  kind: 'input' | 'confirm' | 'select' | 'password' | 'checklist';
  message: string;
  defaultText?: string;
  defaultBoolean?: boolean;
  choices?: WorkflowAskChoice[];
}

export interface WorkflowScoredIntentCandidate {
  kind: 'tool';
  toolName: string;
  args: Record<string, unknown>;
  score: number;
  reason?: string;
  clarification?: {
    ask: WorkflowAskSpec;
    resolveArgs(answer: unknown): Record<string, unknown> | undefined;
  };
}

export interface WorkflowIntentProvider {
  resolveCandidates(
    message: string,
    ctx: ExecutionContext
  ): Promise<WorkflowScoredIntentCandidate[]> | WorkflowScoredIntentCandidate[];
}

export interface WorkflowPreTurnIntent {
  kind: 'tool' | 'clarify_then_tool';
  toolName: string;
  score: number;
  reason?: string;
  args?: Record<string, unknown>;
  ask?: WorkflowAskSpec;
  resolveArgs?: (answer: unknown) => Record<string, unknown> | undefined;
}

export interface IWorkflowToolSource {
  getForAgent(agent: Agent): ICommand[];
}

interface IScoreableTool {
  scorePreLlmIntent?: (
    message: string,
    ctx: ExecutionContext
  ) =>
    | Promise<WorkflowScoredIntentCandidate | WorkflowScoredIntentCandidate[] | undefined>
    | WorkflowScoredIntentCandidate
    | WorkflowScoredIntentCandidate[]
    | undefined;
}

export interface WorkflowPreTurnIntentResolverOptions {
  autoSelectScore?: number;
  confirmThresholdScore?: number;
}

export class WorkflowPreTurnIntentResolver {
  private readonly autoSelectScore: number;
  private readonly confirmThresholdScore: number;

  constructor(
    private readonly toolSource: IWorkflowToolSource,
    options: WorkflowPreTurnIntentResolverOptions = {}
  ) {
    this.autoSelectScore = options.autoSelectScore ?? 100;
    this.confirmThresholdScore = options.confirmThresholdScore ?? 80;
  }

  async resolveAsync(
    message: string,
    ctx: ExecutionContext,
    providers: WorkflowIntentProvider[] = []
  ): Promise<WorkflowPreTurnIntent | undefined> {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || !ctx.agent) {
      return undefined;
    }

    const [providerCandidates, toolCandidates] = await Promise.all([
      this.collectProviderCandidatesAsync(trimmedMessage, ctx, providers),
      this.collectToolCandidatesAsync(trimmedMessage, ctx, this.toolSource.getForAgent(ctx.agent)),
    ]);

    const candidates = this.normalizeCandidates([...providerCandidates, ...toolCandidates]);
    if (candidates.length === 0) {
      return undefined;
    }

    const topCandidate = candidates[0];
    if (topCandidate.score === this.autoSelectScore) {
      return {
        kind: 'tool',
        toolName: topCandidate.toolName,
        args: topCandidate.args,
        score: topCandidate.score,
        reason: topCandidate.reason,
      };
    }

    if (topCandidate.score >= this.confirmThresholdScore) {
      return {
        kind: 'clarify_then_tool',
        toolName: topCandidate.toolName,
        score: topCandidate.score,
        reason: topCandidate.reason,
        ask: topCandidate.clarification?.ask ?? {
          kind: 'confirm',
          message: `shall I call ${topCandidate.toolName}?`,
          defaultBoolean: true,
        },
        resolveArgs:
          topCandidate.clarification?.resolveArgs ??
          ((answer: unknown) => (answer === true ? topCandidate.args : undefined)),
      };
    }

    if (topCandidate.clarification) {
      return {
        kind: 'clarify_then_tool',
        toolName: topCandidate.toolName,
        score: topCandidate.score,
        reason: topCandidate.reason,
        ask: topCandidate.clarification.ask,
        resolveArgs: topCandidate.clarification.resolveArgs,
      };
    }

    return undefined;
  }

  private async collectProviderCandidatesAsync(
    message: string,
    ctx: ExecutionContext,
    providers: WorkflowIntentProvider[]
  ): Promise<WorkflowScoredIntentCandidate[]> {
    const candidates: WorkflowScoredIntentCandidate[] = [];

    for (const provider of providers) {
      try {
        const resolved = await provider.resolveCandidates(message, ctx);
        for (const candidate of resolved ?? []) {
          candidates.push(candidate);
        }
      } catch {
        // Best effort by design.
      }
    }

    return candidates;
  }

  private async collectToolCandidatesAsync(
    message: string,
    ctx: ExecutionContext,
    tools: ICommand[]
  ): Promise<WorkflowScoredIntentCandidate[]> {
    const candidates: WorkflowScoredIntentCandidate[] = [];

    for (const tool of tools) {
      const scoreableTool = tool as ICommand & IScoreableTool;
      if (!scoreableTool.scorePreLlmIntent) {
        continue;
      }

      try {
        const scored = await scoreableTool.scorePreLlmIntent(message, ctx);
        if (Array.isArray(scored)) {
          candidates.push(...scored);
        } else if (scored) {
          candidates.push(scored);
        }
      } catch {
        // Best effort by design.
      }
    }

    return candidates;
  }

  private normalizeCandidates(
    candidates: WorkflowScoredIntentCandidate[]
  ): WorkflowScoredIntentCandidate[] {
    return candidates
      .map((candidate) => ({
        ...candidate,
        score: this.clampScore(candidate.score),
      }))
      .filter((candidate) => candidate.kind === 'tool' && candidate.toolName.trim().length > 0)
      .sort((a, b) => b.score - a.score);
  }

  private clampScore(score: number): number {
    if (!Number.isFinite(score)) {
      return 0;
    }

    if (score < 0) {
      return 0;
    }

    if (score > 100) {
      return 100;
    }

    return Math.round(score);
  }
}
