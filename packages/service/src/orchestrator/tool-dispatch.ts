/**
 * tool-dispatch.ts — single execution gate for all LLM tool calls.
 *
 * Responsibilities:
 *   1. Ask the human for confirmation on write/destructive tools.
 *   2. Execute via ToolManager (permission check + execute).
 *   3. Detect structured results (HandoffRequest, HireResult, …) and surface
 *      them in the return value so the chat loop can act on them.
 *   4. Handle fs_apply_patch proposal persistence inline.
 *   5. Emit lifecycle runtime events throughout.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  isHandoffRequest,
  isHireResult,
  isFindCapableAgentResult,
  isToolCatalogResult,
  isTeamListResult,
  type StructuredToolResult,
} from '@ai-team/core';
import type { FsPathAccessEnvelope } from '../tools/catalog/fs-access.js';
import { ProposalStore } from '../storage/proposal-store.js';
import type { OrchestratorContext } from './pipeline-context.js';
import { requestConfirm } from './question-io.js';
import { emitEvent, emitToolEvent } from './stream-events.js';
import type {
  RuntimeStreamEvent,
  ToolDenialEvent,
  ToolRuntimePayloadEvent,
} from '@ai-team/api-contracts';

// ── Public types ──────────────────────────────────────────────────────────────

export interface ToolCallRequest {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolCallResponse {
  toolCallId: string;
  toolName: string;
  /** Serialised string the LLM receives as the tool result. */
  result: unknown;
  isError: boolean;
  /** Set when the tool returned a typed orchestration result. */
  structured?: StructuredToolResult;
  /** Set when tool execution was denied (user or policy) or failed. */
  denial?: ToolDenial;
}

export type ToolDenialKind = 'user-denied' | 'policy-denied' | 'execution-failed';

export interface ToolDenial {
  kind: ToolDenialKind;
  reasonCode: string;
  message: string;
  blockedPaths?: string[];
  alternativeContexts?: Array<{ contextId: string; allowedPaths: string[] }>;
  handoffRecommendation?: {
    possible: boolean;
    requiresUserApproval: true;
    contexts: Array<{ contextId: string; allowedPaths: string[] }>;
  };
}

interface ToolHistoryIntent {
  mode?: 'summary' | 'analysis';
  regex?: string;
  regexFlags?: string;
  search?: string;
  lineStart?: number;
  lineEnd?: number;
  firstLines?: number;
  lastLines?: number;
  maxChars?: number;
}

interface PreparedHistoryOutput {
  output: string;
  filtered: boolean;
  label?: string;
}

function toToolDenialEvent(denial: ToolDenial): ToolDenialEvent {
  return {
    kind: denial.kind,
    reasonCode: denial.reasonCode,
    message: denial.message,
    blockedPaths: denial.blockedPaths,
    alternativeContexts: denial.alternativeContexts,
    handoffRecommendation: denial.handoffRecommendation,
  };
}

// Tools whose results never need human approval (read-only / info-only).
const SILENT_TOOL_PREFIXES = ['find_', 'list_', 'read_', 'search_', 'get_'];
const SILENT_TOOL_NAMES = new Set([
  'com_handoff', // orchestration — already requires delegation permission
  'com_ask', // interactive clarification tool (must not trigger confirmation recursion)
  'hr_hire', // requires manage-agents permission (checked by ToolManager)
  'http_fetch',
  'http_crawl',
  'fs_who_should',
  'tool_list',
  'team_list',
  'fs_read',
  'fs_read_lines',
  'fs_exists',
  'fs_info',
  'fs_list',
  'fs_tree',
  'fs_search_content',
  'fs_search_metadata',
  'lsp',
]);

const INTERACTIVE_ASK_TIMEOUT_MS = 15 * 60 * 1000;

function requiresConfirmation(toolName: string): boolean {
  if (SILENT_TOOL_NAMES.has(toolName)) return false;
  if (SILENT_TOOL_PREFIXES.some((p) => toolName.startsWith(p))) return false;
  return true;
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

export async function dispatchToolCall(
  call: ToolCallRequest,
  ctx: OrchestratorContext,
  contextFiles?: string[]
): Promise<ToolCallResponse> {
  const { toolName, toolCallId, args } = call;
  const label = `${toolName}(${formatArgs(args)})`;

  emitEvent(ctx.hooks, {
    kind: 'tool',
    toolName,
    toolCallId,
    toolPhase: 'request',
    message: label,
    toolResult: buildPendingToolRuntimePayload(toolName, 'request', args),
  } as RuntimeStreamEvent);

  const deniedByUser = await requestExecutionApproval(toolName, toolCallId, label, args, ctx);
  if (deniedByUser) {
    return {
      toolCallId,
      toolName,
      result: deniedByUser.message,
      isError: false,
      denial: deniedByUser,
    };
  }

  emitEvent(ctx.hooks, {
    kind: 'tool',
    toolName,
    toolCallId,
    toolPhase: 'start',
    message: 'In progress',
    toolResult: buildPendingToolRuntimePayload(toolName, 'start', args),
  } as RuntimeStreamEvent);

  const execResult = await ctx.toolManager.execute(
    ctx.agent,
    toolName,
    args,
    {
      agentId: ctx.agent.id,
      workspaceRoot: ctx.workspaceRoot,
      currentFiles: contextFiles,
      questionInput: ctx.hooks.questionInput,
      questionConfirm: ctx.hooks.questionConfirm,
      questionSelect: ctx.hooks.questionSelect,
      questionPassword: ctx.hooks.questionPassword,
      questionChecklist: ctx.hooks.questionChecklist,
    },
    {
      timeoutMs: toolName === 'com_ask' ? INTERACTIVE_ASK_TIMEOUT_MS : undefined,
    }
  );

  // ── Strip _fileChanges early — before serialisation, history, and events ──
  const fileChanges = execResult.ok ? extractFileChanges(execResult.result) : [];
  const strippedResult =
    fileChanges.length > 0 ? stripFileChanges(execResult.result) : execResult.result;

  // ── Apply per-tool LLM formatting if defined ──────────────────────────────
  const tool = ctx.toolManager.get(toolName);
  const llmResult =
    execResult.ok && tool?.formatForLlm ? tool.formatForLlm(strippedResult) : strippedResult;

  const outputText = execResult.ok
    ? serialise(llmResult)
    : (execResult.error ?? 'Tool execution failed');

  const persistedToolResult = execResult.ok
    ? strippedResult
    : {
        status: 'error' as const,
        message: outputText,
        denial: {
          kind: 'execution-failed' as const,
          reasonCode: 'tool_execution_failed',
        },
      };
  let persistedLlmResult: string | undefined;
  if (execResult.ok) {
    persistedLlmResult = tool?.formatForLlm ? outputText : undefined;
  } else {
    persistedLlmResult = outputText;
  }

  await appendToolHistory(ctx, toolName, outputText, persistedToolResult, persistedLlmResult, args);

  const denial = classifyToolDenial(execResult.ok, strippedResult, outputText);

  let outcome: ToolRuntimePayloadEvent['outcome'];
  if (denial) {
    outcome = 'denied';
  } else if (execResult.ok) {
    outcome = 'result';
  } else {
    outcome = 'error';
  }

  let toolPhase: 'result' | 'error' | 'denied';
  if (denial?.kind === 'policy-denied') {
    toolPhase = 'denied';
  } else if (execResult.ok) {
    toolPhase = 'result';
  } else {
    toolPhase = 'error';
  }

  const toolEventMessage =
    denial?.message ?? (execResult.ok ? formatToolResultPreview(outputText) : outputText);

  const toolEventPayload = buildToolRuntimePayload(
    toolName,
    outcome,
    args,
    execResult.ok ? strippedResult : outputText,
    denial,
    execResult.ok && tool?.formatForLlm ? outputText : undefined
  );

  emitToolEvent(
    ctx.hooks,
    toolName,
    toolCallId,
    toolPhase,
    toolEventMessage,
    denial ? toToolDenialEvent(denial) : undefined,
    toolEventPayload
  );

  const structured = execResult.ok ? asStructuredToolResult(strippedResult) : undefined;

  // ── 5. fs_apply_patch proposal persistence ────────────────────────────────

  if (execResult.ok && toolName === 'fs_apply_patch') {
    await persistCodeEditProposal(execResult.result, args, ctx).catch((err) =>
      console.error('[tool-dispatch] Failed to persist code edit proposal:', err)
    );
  }

  // ── 6. Forward file changes to IDE for diff display ───────────────────────

  if (fileChanges.length > 0) {
    let additions = 0;
    let deletions = 0;
    for (const fc of fileChanges) {
      const oldLines = (fc.oldContent ?? '').split('\n');
      const newLines = (fc.newContent ?? '').split('\n');
      // Simple line-count diff: count added and removed lines
      const maxLen = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < maxLen; i++) {
        if (i >= oldLines.length) {
          additions++;
          continue;
        }
        if (i >= newLines.length) {
          deletions++;
          continue;
        }
        if (oldLines[i] !== newLines[i]) {
          additions++;
          deletions++;
        }
      }
    }

    emitEvent(ctx.hooks, {
      kind: 'code_edit_proposal',
      proposalId: `${toolName}-${toolCallId}`,
      agentName: ctx.agent.name,
      description: `${ctx.agent.name} edited ${fileChanges.length} file(s) via ${toolName}`,
      filesChanged: fileChanges.length,
      additions,
      deletions,
      files: fileChanges.map((fc) => ({
        filePath: fc.filePath,
        oldContent: fc.oldContent,
        newContent: fc.newContent,
      })),
    });
  }

  return {
    toolCallId,
    toolName,
    result: execResult.ok ? strippedResult : outputText,
    isError: !execResult.ok,
    structured,
    denial,
  };
}

async function requestExecutionApproval(
  toolName: string,
  toolCallId: string,
  label: string,
  args: unknown,
  ctx: OrchestratorContext
): Promise<ToolDenial | undefined> {
  if (!requiresConfirmation(toolName)) return undefined;

  const approved = await requestConfirm(ctx.hooks, {
    message: `Allow ${ctx.agent.name} to run ${label}?`,
    default: false,
    style: 'allow',
  });
  if (approved) return undefined;

  const denied = 'Tool call denied by user.';
  const denial: ToolDenial = {
    kind: 'user-denied',
    reasonCode: 'user_declined',
    message: denied,
  };
  emitToolEvent(
    ctx.hooks,
    toolName,
    toolCallId,
    'denied',
    denied,
    toToolDenialEvent(denial),
    buildToolRuntimePayload(toolName, 'denied', undefined, denied, denial)
  );
  await appendToolHistory(
    ctx,
    toolName,
    denied,
    {
      status: 'denied',
      message: denied,
      denial: {
        kind: denial.kind,
        reasonCode: denial.reasonCode,
      },
    },
    denied,
    args
  );
  return denial;
}

function buildToolRuntimePayload(
  toolName: string,
  outcome: ToolRuntimePayloadEvent['outcome'],
  request: unknown,
  result: unknown,
  denial?: ToolDenial,
  resultLlm?: string
): ToolRuntimePayloadEvent {
  return {
    toolName,
    outcome,
    request,
    result,
    resultLlm,
    denial: denial ? toToolDenialEvent(denial) : undefined,
  };
}

function buildPendingToolRuntimePayload(
  toolName: string,
  phase: 'request' | 'start',
  request: unknown
): ToolRuntimePayloadEvent {
  return {
    toolName,
    outcome: phase as unknown as ToolRuntimePayloadEvent['outcome'],
    request,
    result: undefined,
    resultLlm: undefined,
    denial: undefined,
  };
}

function asStructuredToolResult(result: unknown): StructuredToolResult | undefined {
  if (
    isHandoffRequest(result) ||
    isHireResult(result) ||
    isFindCapableAgentResult(result) ||
    isToolCatalogResult(result) ||
    isTeamListResult(result)
  ) {
    return result;
  }
  return undefined;
}

function isAccessEnvelope(v: unknown): v is FsPathAccessEnvelope {
  return !!v && typeof v === 'object' && 'allowed' in v && 'alternativeContexts' in v;
}

function classifyToolDenial(ok: boolean, result: unknown, message: string): ToolDenial | undefined {
  if (!ok) {
    return {
      kind: 'execution-failed',
      reasonCode: 'tool_execution_failed',
      message,
    };
  }

  if (!result || typeof result !== 'object') return undefined;
  const payload = result as Record<string, unknown>;

  const status = typeof payload.status === 'string' ? payload.status : undefined;
  const permissionDenied = status === 'permission_denied';
  const access = payload.access;
  const accessDenied = isAccessEnvelope(access) && !access.allowed;

  if (!permissionDenied && !accessDenied) return undefined;

  const rawAltContexts = extractAlternativeContexts(payload);

  return {
    kind: 'policy-denied',
    reasonCode: permissionDenied ? 'permission_denied' : 'access_denied',
    message: typeof payload.message === 'string' ? payload.message : 'Tool call denied by policy.',
    blockedPaths: extractBlockedPaths(payload),
    alternativeContexts: rawAltContexts,
    handoffRecommendation: {
      possible: rawAltContexts.length > 0,
      requiresUserApproval: true,
      contexts: rawAltContexts,
    },
  };
}

function extractAlternativeContexts(
  payload: Record<string, unknown>
): Array<{ contextId: string; allowedPaths: string[] }> {
  const direct = payload.alternativeContexts;
  const access = payload.access;
  const accessAlternatives = isAccessEnvelope(access) ? access.alternativeContexts : undefined;

  const candidates = [direct, accessAlternatives];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        contextId: typeof item.contextId === 'string' ? item.contextId : '',
        allowedPaths: Array.isArray(item.allowedPaths)
          ? item.allowedPaths.filter((p): p is string => typeof p === 'string')
          : [],
      }))
      .filter((item) => item.contextId.length > 0);
  }

  return [];
}

function extractBlockedPaths(payload: Record<string, unknown>): string[] {
  const blockedFiles = payload.blockedFiles;
  if (!Array.isArray(blockedFiles)) return [];

  return blockedFiles
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => (typeof item.filePath === 'string' ? item.filePath : ''))
    .filter((p) => p.length > 0);
}

// ── History persistence ───────────────────────────────────────────────────────

async function appendToolHistory(
  ctx: OrchestratorContext,
  toolName: string,
  output: string,
  rawResult?: unknown,
  llmResult?: string,
  callArgs?: unknown
): Promise<void> {
  let content = '';
  if (rawResult === undefined) {
    const prepared = await prepareToolOutputForHistory(ctx, toolName, output);
    content =
      prepared.filtered && prepared.label
        ? `Tool ${toolName} [filtered:${prepared.label}] ${prepared.output}`
        : `Tool ${toolName}: ${prepared.output}`;
  }

  const toolCall =
    rawResult !== undefined
      ? {
          tool: toolName,
          params: (callArgs ?? {}) as Record<string, unknown>,
          result: rawResult,
          ...(llmResult !== undefined ? { resultLlm: llmResult } : {}),
        }
      : undefined;

  await ctx.sessionManager.appendMessage(ctx.sessionId, {
    from: ctx.agent.id,
    content,
    timestamp: new Date().toISOString(),
    isHuman: false,
    tool_calls: toolCall ? [toolCall] : undefined,
  });
}

async function prepareToolOutputForHistory(
  ctx: OrchestratorContext,
  toolName: string,
  output: string
): Promise<PreparedHistoryOutput> {
  const latestUserText = getLatestHumanMessageText(ctx);
  const intent = parseToolHistoryIntent(latestUserText);
  const deterministic = applyDeterministicFilters(output, intent);

  if (intent.mode) {
    const llmTransformed = await applyLlmTransform(
      ctx,
      toolName,
      deterministic.output,
      intent.mode
    );
    if (llmTransformed) {
      return {
        output: llmTransformed,
        filtered: true,
        label: `${intent.mode},${deterministic.label}`,
      };
    }
  }

  return {
    output: deterministic.output,
    filtered: deterministic.changed,
    label: deterministic.label,
  };
}

function getLatestHumanMessageText(ctx: OrchestratorContext): string {
  for (let i = ctx.history.length - 1; i >= 0; i -= 1) {
    const msg = ctx.history[i];
    if (msg.isHuman || msg.from === 'human') {
      return msg.content || '';
    }
  }
  return '';
}

function parseToolHistoryIntent(input: string): ToolHistoryIntent {
  const intent: ToolHistoryIntent = {};

  if (/\b(summarize|summary|most important|key points|tldr|tl;dr)\b/i.test(input)) {
    intent.mode = 'summary';
  }
  if (/\b(analyze|analysis|implications|risks|action items|next steps)\b/i.test(input)) {
    intent.mode = 'analysis';
  }

  const lineRange = /lines?\s+(\d+)\s*[-:]\s*(\d+)/i.exec(input);
  if (lineRange) {
    intent.lineStart = Number(lineRange[1]);
    intent.lineEnd = Number(lineRange[2]);
  }

  const firstLines = /first\s+(\d+)\s+lines?/i.exec(input);
  if (firstLines) intent.firstLines = Number(firstLines[1]);

  const lastLines = /last\s+(\d+)\s+lines?/i.exec(input);
  if (lastLines) intent.lastLines = Number(lastLines[1]);

  const maxChars = /(?:max|limit)\s+(\d+)\s*(?:chars?|characters?)/i.exec(input);
  if (maxChars) intent.maxChars = Number(maxChars[1]);

  const regexLiteral = /regex\s*[:=]\s*\/(.+)\/([gimsuy]*)/i.exec(input);
  if (regexLiteral) {
    intent.regex = regexLiteral[1];
    intent.regexFlags = regexLiteral[2] || 'i';
  } else {
    const regexLoose = /regex\s*[:=]\s*([^\n]+)/i.exec(input);
    if (regexLoose) {
      intent.regex = regexLoose[1].trim();
      intent.regexFlags = 'i';
    }
  }

  const quotedSearch = /search(?:\s+for)?\s+"([^"]+)"/i.exec(input);
  if (quotedSearch) {
    intent.search = quotedSearch[1];
  } else {
    const bareSearch = /search(?:\s+for)?\s+([^\n]+)/i.exec(input);
    if (bareSearch) intent.search = bareSearch[1].trim();
  }

  return intent;
}

function applyDeterministicFilters(
  output: string,
  intent: ToolHistoryIntent
): { output: string; changed: boolean; label: string } {
  const DEFAULT_MAX_LINES = 120;
  const DEFAULT_MAX_CHARS = 6000;
  const LARGE_OUTPUT_CHARS = 8000;
  const LARGE_OUTPUT_LINES = 200;

  let text = output.replaceAll(/\r\n?/g, '\n');
  const labels: string[] = [];
  const original = text;
  const jsonDocument = isLikelyJsonDocument(original);

  if (intent.search) {
    const needle = intent.search.toLowerCase();
    text = text
      .split('\n')
      .filter((line) => line.toLowerCase().includes(needle))
      .join('\n');
    labels.push('search');
  }

  if (intent.regex) {
    try {
      const re = new RegExp(intent.regex, intent.regexFlags || 'i');
      text = text
        .split('\n')
        .filter((line) => re.test(line))
        .join('\n');
      labels.push('regex');
    } catch {
      labels.push('regex-invalid');
    }
  }

  let lines = text.split('\n');
  const lineFilter = applyLineWindow(lines, intent);
  lines = lineFilter.lines;
  if (lineFilter.label) labels.push(lineFilter.label);

  const isLarge = lines.length > LARGE_OUTPUT_LINES || original.length > LARGE_OUTPUT_CHARS;
  if (!jsonDocument && isLarge && lines.length > DEFAULT_MAX_LINES) {
    lines = lines.slice(0, DEFAULT_MAX_LINES);
    labels.push('auto-max-lines');
  }

  text = lines.join('\n');

  const maxChars = intent.maxChars ?? (!jsonDocument && isLarge ? DEFAULT_MAX_CHARS : undefined);
  if (maxChars !== undefined && text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n…[history-truncated at ${maxChars} chars]`;
    labels.push(intent.maxChars ? 'max-chars' : 'auto-max-chars');
  }

  const changed = text !== original;
  return {
    output: changed ? text : output,
    changed,
    label: labels.length > 0 ? labels.join(',') : 'none',
  };
}

function applyLineWindow(
  lines: string[],
  intent: ToolHistoryIntent
): { lines: string[]; label?: string } {
  if (intent.lineStart !== undefined && intent.lineEnd !== undefined) {
    const start = Math.max(1, Math.min(intent.lineStart, lines.length || 1));
    const end = Math.max(start, Math.min(intent.lineEnd, lines.length || start));
    return {
      lines: lines.slice(start - 1, end),
      label: 'line-range',
    };
  }

  if (intent.firstLines !== undefined) {
    return {
      lines: lines.slice(0, Math.max(1, intent.firstLines)),
      label: 'first-lines',
    };
  }

  if (intent.lastLines !== undefined) {
    return {
      lines: lines.slice(Math.max(0, lines.length - Math.max(1, intent.lastLines))),
      label: 'last-lines',
    };
  }

  return { lines };
}

async function applyLlmTransform(
  ctx: OrchestratorContext,
  toolName: string,
  input: string,
  mode: 'summary' | 'analysis'
): Promise<string | undefined> {
  const llm = ctx.llmService as {
    rawChat?: (
      systemPrompt: string,
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
      options?: { maxTokens?: number; temperature?: number }
    ) => Promise<string>;
  };

  if (typeof llm.rawChat !== 'function') return undefined;
  if (!input.trim()) return input;

  const clipped = input.length > 20_000 ? `${input.slice(0, 20_000)}\n...[input clipped]` : input;
  const systemPrompt =
    mode === 'summary'
      ? 'Summarize tool output faithfully and concisely. Keep key facts, counts, errors, and URLs. Do not invent details. Max 12 bullets.'
      : 'Analyze tool output concisely. Return: key findings, risks/issues, and actionable next steps. Do not invent details.';

  try {
    const transformed = await llm.rawChat(
      systemPrompt,
      [{ role: 'user', content: `Tool: ${toolName}\n\n${clipped}` }],
      { maxTokens: 450, temperature: 0.1 }
    );
    return transformed.trim();
  } catch {
    return undefined;
  }
}

// ── fs_apply_patch proposal ──────────────────────────────────────────────────

async function persistCodeEditProposal(
  result: unknown,
  args: unknown,
  ctx: OrchestratorContext
): Promise<void> {
  const r = result as Record<string, unknown>;
  if (r?.status !== 'pending_approval') return;

  const proposalId = r.proposalId as string;
  const changes = ((args as any)?.changes ?? []) as Array<{
    filePath: string;
    oldContent: string;
    newContent: string;
  }>;

  const resolvedFiles: typeof changes = [];
  for (const change of changes) {
    const absPath = path.isAbsolute(change.filePath)
      ? change.filePath
      : path.join(ctx.workspaceRoot, change.filePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, change.newContent, 'utf8');
    resolvedFiles.push({
      filePath: absPath,
      oldContent: change.oldContent,
      newContent: change.newContent,
    });
  }

  const store = new ProposalStore(ctx.workspaceRoot);
  store.save({
    proposalId,
    agentName: ctx.agent.name,
    description: (r.description as string) ?? '',
    createdAt: new Date().toISOString(),
    files: resolvedFiles,
  });

  let additions = typeof r.additions === 'number' ? r.additions : 0;
  let deletions = typeof r.deletions === 'number' ? r.deletions : 0;
  if (additions === 0 && deletions === 0) {
    for (const f of resolvedFiles) {
      const oldLines = (f.oldContent ?? '').split('\n');
      const newLines = (f.newContent ?? '').split('\n');
      const maxLen = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < maxLen; i++) {
        if (i >= oldLines.length) {
          additions++;
          continue;
        }
        if (i >= newLines.length) {
          deletions++;
          continue;
        }
        if (oldLines[i] !== newLines[i]) {
          additions++;
          deletions++;
        }
      }
    }
  }

  emitEvent(ctx.hooks, {
    kind: 'code_edit_proposal',
    proposalId,
    agentName: ctx.agent.name,
    description: r.description as string,
    filesChanged: resolvedFiles.length,
    additions,
    deletions,
    warnings: r.warnings as string[],
    files: resolvedFiles,
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatArgs(args: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  if (typeof args === 'number' || typeof args === 'boolean' || typeof args === 'bigint') {
    return `${args}`;
  }
  if (typeof args === 'symbol') {
    return args.description ? `Symbol(${args.description})` : 'Symbol()';
  }
  if (typeof args === 'function') return '[function]';
  try {
    const s = JSON.stringify(args);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  } catch {
    return '[unparseable]';
  }
}

function formatToolResultPreview(outputText: string): string {
  const trimmed = outputText.trim();
  if (!trimmed) {
    return 'Completed';
  }

  // Preserve complete JSON payloads in tool events so downstream consumers
  // receive structurally intact data rather than clipped previews.
  if (isLikelyJsonDocument(trimmed)) {
    return trimmed;
  }

  const collapsed = outputText.replaceAll(/\s+/g, ' ').trim();

  const MAX_LEN = 220;
  if (collapsed.length <= MAX_LEN) {
    return collapsed;
  }

  return `${collapsed.slice(0, MAX_LEN - 1)}…`;
}

function isLikelyJsonDocument(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (
    !(
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    )
  ) {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function serialise(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

// ── File-change detection helpers ─────────────────────────────────────────────

interface FileChange {
  filePath: string;
  oldContent: string;
  newContent: string;
}

function extractFileChanges(result: unknown): FileChange[] {
  if (result == null || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r._fileChanges)) return [];
  return r._fileChanges as FileChange[];
}

function stripFileChanges(result: unknown): unknown {
  if (result == null || typeof result !== 'object') return result;
  const r = result as Record<string, unknown>;
  if (!('_fileChanges' in r)) return result;
  const { _fileChanges: _, ...rest } = r;
  return rest;
}
