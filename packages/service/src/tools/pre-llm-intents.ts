import type { Agent, ICommand, ExecutionContext } from '@ai-team/core';

const AUTO_SELECT_SCORE = 100;
const CONFIRM_THRESHOLD_SCORE = 80;

type AskKind = 'input' | 'confirm' | 'select' | 'password' | 'checklist';

interface AskChoice {
  name: string;
  value: string;
  description?: string;
  recommended?: boolean;
}

export interface PreLlmAskSpec {
  kind: AskKind;
  message: string;
  defaultText?: string;
  defaultBoolean?: boolean;
  choices?: AskChoice[];
  defaultChecklist?: string[];
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
  minSelections?: number;
  maxSelections?: number;
}

export interface ScoredPreLlmIntentCandidate {
  kind: 'tool';
  toolName: string;
  args: Record<string, unknown>;
  /** 1..100 confidence score where 100 means deterministic certainty. */
  score: number;
  reason?: string;
  source?: string;
  clarification?: {
    ask: PreLlmAskSpec;
    resolveArgs(answer: unknown): Record<string, unknown> | undefined;
  };
}

export interface PreLlmIntentProvider {
  resolveCandidates(
    message: string,
    ctx: ExecutionContext
  ): Promise<ScoredPreLlmIntentCandidate[]> | ScoredPreLlmIntentCandidate[];
}

interface ScoreableTool {
  scorePreLlmIntent?: (
    message: string,
    ctx: ExecutionContext
  ) =>
    | Promise<ScoredPreLlmIntentCandidate | ScoredPreLlmIntentCandidate[] | undefined>
    | ScoredPreLlmIntentCandidate
    | ScoredPreLlmIntentCandidate[]
    | undefined;
}

export type PreLlmIntent =
  | {
      kind: 'tool';
      toolName: string;
      args: Record<string, unknown>;
      score: number;
      reason?: string;
    }
  | {
      kind: 'clarify_then_tool';
      toolName: string;
      ask: PreLlmAskSpec;
      score: number;
      reason?: string;
      resolveArgs(answer: unknown): Record<string, unknown> | undefined;
    };

function clampScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return Math.round(score);
}

function hasInferableArgs(args: unknown): args is Record<string, unknown> {
  return !!args && typeof args === 'object' && !Array.isArray(args);
}

function canExecuteCandidate(candidate: ScoredPreLlmIntentCandidate): boolean {
  return hasInferableArgs(candidate.args) || Boolean(candidate.clarification);
}

function normalizeCandidates(
  candidates: ScoredPreLlmIntentCandidate[]
): ScoredPreLlmIntentCandidate[] {
  return candidates
    .map((c) => ({ ...c, score: clampScore(c.score) }))
    .filter((c) => c.kind === 'tool' && c.toolName.trim().length > 0 && c.score >= 1)
    .sort((a, b) => b.score - a.score);
}

async function collectToolCandidates(
  message: string,
  ctx: ExecutionContext,
  tools: ICommand[]
): Promise<ScoredPreLlmIntentCandidate[]> {
  const candidates: ScoredPreLlmIntentCandidate[] = [];

  for (const tool of tools) {
    const scoreable = tool as ICommand & ScoreableTool;
    if (typeof scoreable.scorePreLlmIntent !== 'function') continue;

    try {
      const scored = await scoreable.scorePreLlmIntent(message, ctx);
      let next: Array<ScoredPreLlmIntentCandidate> = [];
      if (Array.isArray(scored)) {
        next = scored;
      } else if (scored) {
        next = [scored];
      }
      for (const candidate of next) {
        candidates.push({
          ...candidate,
          source: candidate.source ?? `tool:${tool.metadata.group ?? 'tool'}_${tool.metadata.key}`,
        });
      }
    } catch {
      // Pre-LLM intent scoring is best-effort and must never break chat flow.
    }
  }

  return candidates;
}

async function collectProviderCandidates(
  message: string,
  ctx: ExecutionContext,
  providers: PreLlmIntentProvider[]
): Promise<ScoredPreLlmIntentCandidate[]> {
  const candidates: ScoredPreLlmIntentCandidate[] = [];

  for (const provider of providers) {
    try {
      const resolved = await provider.resolveCandidates(message, ctx);
      for (const candidate of resolved ?? []) {
        candidates.push({ ...candidate, source: candidate.source ?? 'workflow-provider' });
      }
    } catch {
      // Provider failures should never block turn processing.
    }
  }

  return candidates;
}

function formatToolCallPreview(candidate: ScoredPreLlmIntentCandidate): string {
  const serializedArgs = JSON.stringify(candidate.args ?? {});
  return `${candidate.toolName}${serializedArgs ?? '{}'}`;
}

function buildHighScoreSelectionIntent(candidates: ScoredPreLlmIntentCandidate[]): PreLlmIntent {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const options = sorted.map((candidate, index) => ({
    name: `shall i call ${formatToolCallPreview(candidate)}?`,
    value: String(index),
    description: candidate.reason
      ? `score ${candidate.score} — ${candidate.reason}`
      : `score ${candidate.score}`,
    recommended: index === 0,
  }));

  return {
    kind: 'clarify_then_tool',
    toolName: sorted[0].toolName,
    score: sorted[0].score,
    reason: `Multiple pre-LLM tools scored >= ${CONFIRM_THRESHOLD_SCORE}.`,
    ask: {
      kind: 'select',
      message:
        'Multiple tools are highly relevant. Select one to run before I proceed with LLM reasoning.',
      choices: options,
      defaultText: '0',
    },
    resolveArgs(answer: unknown) {
      const selectedIndex =
        typeof answer === 'string' && /^\d+$/.test(answer) ? Number.parseInt(answer, 10) : 0;
      const selected = sorted[selectedIndex] ?? sorted[0];
      return selected?.args;
    },
  };
}

function buildConfirmIntent(candidate: ScoredPreLlmIntentCandidate): PreLlmIntent {
  return {
    kind: 'clarify_then_tool',
    toolName: candidate.toolName,
    score: candidate.score,
    reason: candidate.reason,
    ask: {
      kind: 'confirm',
      message: `shall i call ${formatToolCallPreview(candidate)}?`,
      defaultBoolean: true,
    },
    resolveArgs(answer: unknown) {
      return answer === true ? candidate.args : undefined;
    },
  };
}

/**
 * Minimal interface for a tool source that can resolve which tools are
 * available to a given agent. Implemented by ToolManager but kept narrow
 * here so callers outside the full DI graph can satisfy it with a simple
 * mock in tests.
 */
export interface IPreLlmToolSource {
  getForAgent(agent: Agent): ICommand[];
}

/**
 * Resolves pre-LLM intents by scoring tools against the incoming message.
 * Requires an IPreLlmToolSource to be injected — never reads from ExecutionContext.
 *
 * Scoring rules:
 * - score=100  → auto-execute immediately
 * - multiple tools score >=80 → user selects which tool to call
 * - single tool scores >=80  → user confirms: "shall I call toolName(args)?"
 * - tools are callable only when args are inferable or a clarification strategy exists
 */
export class PreLlmIntentResolver {
  constructor(private readonly toolSource: IPreLlmToolSource) {}

  async resolve(
    message: string,
    ctx: ExecutionContext,
    providers: PreLlmIntentProvider[] = []
  ): Promise<PreLlmIntent | undefined> {
    const trimmed = message.trim();
    if (!trimmed || !ctx.agent) return undefined;

    const tools = this.toolSource.getForAgent(ctx.agent);

    const [providerCandidates, toolCandidates] = await Promise.all([
      collectProviderCandidates(trimmed, ctx, providers),
      collectToolCandidates(trimmed, ctx, tools),
    ]);

    const candidates = normalizeCandidates([...providerCandidates, ...toolCandidates]).filter(
      canExecuteCandidate
    );
    if (candidates.length === 0) return undefined;

    const top = candidates[0];
    if (!top) return undefined;

    if (top.score === AUTO_SELECT_SCORE && hasInferableArgs(top.args)) {
      return {
        kind: 'tool',
        toolName: top.toolName,
        args: top.args,
        score: top.score,
        reason: top.reason,
      };
    }

    const highScoreCandidates = candidates.filter(
      (candidate) => candidate.score >= CONFIRM_THRESHOLD_SCORE && hasInferableArgs(candidate.args)
    );
    if (highScoreCandidates.length > 1) {
      return buildHighScoreSelectionIntent(highScoreCandidates);
    }

    if (highScoreCandidates.length === 1) {
      return buildConfirmIntent(highScoreCandidates[0]);
    }

    if (top.clarification) {
      return {
        kind: 'clarify_then_tool',
        toolName: top.toolName,
        score: top.score,
        reason: top.reason,
        ask: top.clarification.ask,
        resolveArgs: top.clarification.resolveArgs,
      };
    }

    return undefined;
  }
}
