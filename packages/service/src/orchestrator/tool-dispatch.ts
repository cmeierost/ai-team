/**
 * tool-dispatch.ts — single execution gate for all LLM tool calls.
 *
 * Responsibilities:
 *   1. Route ask_human / ask_question to question-io (bypass ToolManager).
 *   2. Ask the human for confirmation on write/destructive tools.
 *   3. Execute via ToolManager (permission check + execute).
 *   4. Detect structured results (HandoffRequest, HireResult, …) and surface
 *      them in the return value so the chat loop can act on them.
 *   5. Handle apply_code_edit proposal persistence inline.
 *   6. Emit lifecycle runtime events throughout.
 */

import path from 'path';
import { promises as fs } from 'fs';
import {
  isHandoffRequest,
  isHireResult,
  isFindCapableAgentResult,
  isToolCatalogResult,
  type StructuredToolResult,
} from '@ai-team/core';
import { ProposalStore } from '../storage/proposal-store.js';
import type { OrchestratorContext } from './pipeline-context.js';
import { requestConfirm } from './question-io.js';
import { emitEvent, emitToolEvent } from './stream-events.js';

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
}

// ── Interactive question tool detection ───────────────────────────────────────

const QUESTION_TOOL_NAMES = new Set(['ask_human', 'ask_question']);

function isQuestionTool(toolName: string): boolean {
  return QUESTION_TOOL_NAMES.has(toolName);
}

// Tools whose results never need human approval (read-only / info-only).
const SILENT_TOOL_PREFIXES = ['find_', 'list_', 'read_', 'search_', 'get_'];
const SILENT_TOOL_NAMES = new Set([
  'handoff_to_agent',   // orchestration — already requires delegation permission
  'hire_agent',         // requires manage-agents permission (checked by ToolManager)
  'find_capable_agent',
  'list_tools',
  'fs_read_file',
  'fs_read_lines',
  'fs_exists',
  'fs_info',
  'fs_list',
  'fs_tree',
  'fs_search_content',
  'fs_search_metadata',
  'ask_human',
  'ask_question',
]);

function requiresConfirmation(toolName: string): boolean {
  if (SILENT_TOOL_NAMES.has(toolName)) return false;
  if (SILENT_TOOL_PREFIXES.some(p => toolName.startsWith(p))) return false;
  return true;
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

export async function dispatchToolCall(
  call: ToolCallRequest,
  ctx: OrchestratorContext,
  contextFiles?: string[],
): Promise<ToolCallResponse> {
  const { toolName, toolCallId, args } = call;
  const label = `${toolName}(${formatArgs(args)})`;

  emitEvent(ctx.hooks, { kind: 'tool', toolName, toolPhase: 'request', message: label });

  // ── 1. Interactive question tools ─────────────────────────────────────────

  if (isQuestionTool(toolName)) {
    emitToolEvent(ctx.hooks, toolName, 'start', 'Asking developer question');
    const execution = await executeQuestionTool(toolName, args, ctx);

    await appendToolHistory(ctx, toolName, serialise(execution.ok ? execution.result : execution.error));

    emitToolEvent(
      ctx.hooks,
      toolName,
      execution.ok ? 'result' : 'error',
      execution.ok ? 'Question answered' : (execution.error ?? 'Question tool failed'),
    );

    return {
      toolCallId,
      toolName,
      result: execution.ok ? execution.result : execution.error,
      isError: !execution.ok,
    };
  }

  // ── 2. Human confirmation for write/dangerous tools ───────────────────────

  let approved = true;
  if (requiresConfirmation(toolName)) {
    approved = await requestConfirm(ctx.hooks, {
      message: `Allow ${ctx.agent.name} to run ${label}?`,
      default: false,
    });

    if (!approved) {
      emitToolEvent(ctx.hooks, toolName, 'denied', 'Tool call denied by user');
      const denied = 'Tool call denied by user.';
      await appendToolHistory(ctx, toolName, denied);
      return { toolCallId, toolName, result: denied, isError: false };
    }
  }

  emitToolEvent(ctx.hooks, toolName, 'start', 'Executing');

  // ── 3. Execute via ToolManager ─────────────────────────────────────────────

  const execResult = await ctx.toolManager.execute(
    ctx.agent,
    toolName,
    args,
    { workspaceRoot: ctx.workspaceRoot, currentFiles: contextFiles },
  );

  const outputText = execResult.ok
    ? serialise(execResult.result)
    : (execResult.error ?? 'Tool execution failed');

  await appendToolHistory(ctx, toolName, outputText);

  emitToolEvent(
    ctx.hooks,
    toolName,
    execResult.ok ? 'result' : 'error',
    execResult.ok ? 'Completed' : outputText,
  );

  // ── 4. Detect structured results ──────────────────────────────────────────

  let structured: StructuredToolResult | undefined;
  if (execResult.ok) {
    const r = execResult.result;
    if (isHandoffRequest(r) || isHireResult(r) || isFindCapableAgentResult(r) || isToolCatalogResult(r)) {
      structured = r;
    }
  }

  // ── 5. apply_code_edit proposal persistence ───────────────────────────────

  if (execResult.ok && toolName === 'apply_code_edit') {
    await persistCodeEditProposal(execResult.result, args, ctx).catch(err =>
      console.error('[tool-dispatch] Failed to persist code edit proposal:', err),
    );
  }

  return {
    toolCallId,
    toolName,
    result: execResult.ok ? execResult.result : outputText,
    isError: !execResult.ok,
    structured,
  };
}

// ── History persistence ───────────────────────────────────────────────────────

async function appendToolHistory(
  ctx: OrchestratorContext,
  toolName: string,
  output: string,
): Promise<void> {
  await ctx.sessionManager.appendMessage(ctx.sessionId, {
    from: ctx.agent.id,
    content: `[tool:${toolName}] ${output}`,
    timestamp: new Date().toISOString(),
    isHuman: false,
  });
}

// ── apply_code_edit proposal ──────────────────────────────────────────────────

async function persistCodeEditProposal(
  result: unknown,
  args: unknown,
  ctx: OrchestratorContext,
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
    resolvedFiles.push({ filePath: absPath, oldContent: change.oldContent, newContent: change.newContent });
  }

  const store = new ProposalStore(ctx.workspaceRoot);
  store.save({
    proposalId,
    agentName: ctx.agent.name,
    description: (r.description as string) ?? '',
    createdAt: new Date().toISOString(),
    files: resolvedFiles,
  });

  emitEvent(ctx.hooks, {
    kind: 'code_edit_proposal',
    proposalId,
    agentName: ctx.agent.name,
    description: r.description as string,
    filesChanged: resolvedFiles.length,
    additions: r.additions as number,
    deletions: r.deletions as number,
    warnings: r.warnings as string[],
    files: resolvedFiles,
  });
}

// ── Question tool routing ─────────────────────────────────────────────────────

import { requestInput, requestSelect, requestPassword, requestChecklist } from './question-io.js';

interface QuestionArgs {
  question: string;
  questionType?: 'input' | 'confirm' | 'select' | 'checklist' | 'password';
  context?: string;
  choices?: Array<{ name: string; value: string }>;
  default?: unknown;
  allowEmpty?: boolean;
  mask?: string;
}

function parseQuestionArgs(args: unknown): { ok: true; value: QuestionArgs } | { ok: false; error: string } {
  if (!args || typeof args !== 'object') {
    return { ok: false, error: 'ask_human expects an object payload.' };
  }
  const raw = args as Record<string, unknown>;
  const question = typeof raw.question === 'string' ? raw.question.trim() : '';
  if (!question) return { ok: false, error: 'ask_human requires a non-empty question field.' };

  const type = typeof raw.questionType === 'string' ? raw.questionType : 'input';
  const validTypes = ['input', 'confirm', 'select', 'checklist', 'password'] as const;
  if (!validTypes.includes(type as typeof validTypes[number])) {
    return { ok: false, error: `Unsupported questionType '${type}'.` };
  }

  const choices = Array.isArray(raw.choices)
    ? raw.choices
        .filter(e => e && typeof e === 'object')
        .map(e => {
          const r = e as Record<string, unknown>;
          return typeof r.name === 'string' && typeof r.value === 'string'
            ? { name: r.name, value: r.value }
            : undefined;
        })
        .filter((e): e is { name: string; value: string } => Boolean(e))
    : undefined;

  if ((type === 'select' || type === 'checklist') && (!choices || choices.length === 0)) {
    return { ok: false, error: `questionType '${type}' requires a non-empty choices array.` };
  }

  return {
    ok: true,
    value: {
      question,
      questionType: type as QuestionArgs['questionType'],
      context: typeof raw.context === 'string' ? raw.context : undefined,
      choices,
      default: raw.default,
      allowEmpty: typeof raw.allowEmpty === 'boolean' ? raw.allowEmpty : undefined,
      mask: typeof raw.mask === 'string' ? raw.mask : undefined,
    },
  };
}

async function executeQuestionTool(
  toolName: string,
  args: unknown,
  ctx: OrchestratorContext,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const parsed = parseQuestionArgs(args);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { question, questionType = 'input', context, choices, default: def, allowEmpty, mask } = parsed.value;
  const message = context ? `${question}\n\nContext: ${context}` : question;

  try {
    switch (questionType) {
      case 'confirm': {
        const answer = await requestConfirm(ctx.hooks, {
          message,
          default: typeof def === 'boolean' ? def : false,
        });
        return { ok: true, result: { question, questionType, answer } };
      }
      case 'select': {
        const answer = await requestSelect(ctx.hooks, {
          message,
          choices: choices!,
        });
        return { ok: true, result: { question, questionType, answer } };
      }
      case 'checklist': {
        const answer = await requestChecklist(ctx.hooks, {
          message,
          choices: choices!,
        });
        return { ok: true, result: { question, questionType, answer } };
      }
      case 'password': {
        const answer = await requestPassword(ctx.hooks, {
          message,
          mask,
        });
        return { ok: true, result: { question, questionType, answer } };
      }
      default: {
        const answer = await requestInput(ctx.hooks, {
          message,
          validate: allowEmpty
            ? undefined
            : (v: string) => v.trim().length > 0 || 'Please provide a non-empty value.',
        });
        return { ok: true, result: { question, questionType, answer } };
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return String(args ?? '');
  try {
    const s = JSON.stringify(args);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
  } catch {
    return '[unparseable]';
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
