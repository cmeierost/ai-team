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

import {
  isHandoffRequest,
  isHireResult,
  isFindCapableAgentResult,
  isToolCatalogResult,
  isTeamListResult,
  type StructuredToolResult,
  type ExecutionContext,
  type CommandResponse as CoreCommandResponse,
} from '@ai-team/core';
import type { ToolManager } from '../tools/tool-manager.js';
import type { SessionManager } from '../session-manager.js';
import type { IQuestionService } from '../questions/question-service.js';
import { emitEvent, emitToolEvent } from './stream-events.js';
import type { RuntimeStreamEvent, ToolRuntimePayloadEvent } from '@ai-team/api-contracts';
import {
  ToolDispatchSupportService,
  type ToolDenial,
} from './services/tool-dispatch-support-service.js';

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

const INTERACTIVE_ASK_TIMEOUT_MS = 15 * 60 * 1000;
const tick = () => new Promise<void>((r) => setImmediate(r));

// ── ToolDispatcher class ──────────────────────────────────────────────────────

export class ToolDispatcher {
  constructor(
    private readonly toolManager: ToolManager,
    private readonly sessionManager: SessionManager,
    private readonly support: ToolDispatchSupportService,
    private readonly questionService: IQuestionService
  ) {}

  async dispatch(
    call: ToolCallRequest,
    ctx: ExecutionContext,
    contextFiles?: string[]
  ): Promise<ToolCallResponse> {
    const { toolName, toolCallId, args } = call;
    const label = `${toolName}(${this.support.formatArgs(args)})`;
    this.emitToolLifecycle('request', toolName, toolCallId, label, args, ctx);

    const deniedByUser = await this._requestExecutionApproval(
      toolName,
      toolCallId,
      label,
      args,
      ctx
    );
    if (deniedByUser) {
      return {
        toolCallId,
        toolName,
        result: deniedByUser.message,
        isError: false,
        denial: deniedByUser,
      };
    }

    this.emitToolLifecycle('start', toolName, toolCallId, 'In progress', args, ctx);

    const execResult = await this.toolManager.execute(
      ctx.agent!,
      toolName,
      args,
      this.buildExecutionContext(ctx, contextFiles),
      {
        timeoutMs: toolName === 'com_ask' ? INTERACTIVE_ASK_TIMEOUT_MS : undefined,
      }
    );

    const processed = this.prepareExecutionOutput(execResult, toolName);
    await this._appendToolHistory(
      ctx,
      toolName,
      processed.outputText,
      processed.persistedToolResult,
      processed.persistedLlmResult,
      args
    );

    const toolEvent = this.buildToolEvent(toolName, args, processed);
    emitToolEvent(
      toolName,
      toolCallId,
      toolEvent.toolPhase,
      toolEvent.toolEventMessage,
      toolEvent.toolDenial,
      toolEvent.toolEventPayload
    );

    const structured = execResult.ok ? asStructuredToolResult(processed.strippedResult) : undefined;

    if (execResult.ok && toolName === 'fs_apply_patch') {
      await this.support
        .persistCodeEditProposal(execResult.result, args, ctx)
        .catch((err) =>
          console.error('[tool-dispatch] Failed to persist code edit proposal:', err)
        );
    }

    this.emitFileChangeProposal(toolName, toolCallId, processed.fileChanges, ctx);

    return {
      toolCallId,
      toolName,
      result: execResult.ok ? processed.strippedResult : processed.outputText,
      isError: !execResult.ok,
      structured,
      denial: processed.denial,
    };
  }

  private async _requestExecutionApproval(
    toolName: string,
    toolCallId: string,
    label: string,
    args: unknown,
    ctx: ExecutionContext
  ): Promise<ToolDenial | undefined> {
    if (!this.support.requiresConfirmation(toolName)) return undefined;

    await tick();
    const approved = await this.questionService.confirm(
      {
        message: `Allow ${ctx.agent!.name} to run ${label}?`,
        default: false,
        style: 'allow',
      }
    );
    if (approved) return undefined;

    const denied = 'Tool call denied by user.';
    const denial: ToolDenial = {
      kind: 'user-denied',
      reasonCode: 'user_declined',
      message: denied,
    };
    emitToolEvent(
      toolName,
      toolCallId,
      'denied',
      denied,
      this.support.toToolDenialEvent(denial),
      this.support.buildToolRuntimePayload(
        toolName,
        'denied',
        undefined,
        this.support.buildToolCommandResponse(toolName, denied, denied, denial),
        denial
      )
    );
    await this._appendToolHistory(
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

  private async _appendToolHistory(
    ctx: ExecutionContext,
    toolName: string,
    output: string,
    rawResult?: unknown,
    llmResult?: string,
    callArgs?: unknown
  ): Promise<void> {
    let content = '';
    let toolCall:
      | { tool: string; params: Record<string, unknown>; result: unknown; resultLlm?: string }
      | undefined;
    if (rawResult === undefined) {
      const prepared = await this.support.prepareToolOutputForHistory(ctx, toolName, output);
      content =
        prepared.filtered && prepared.label
          ? `Tool ${toolName} [filtered:${prepared.label}] ${prepared.output}`
          : `Tool ${toolName}: ${prepared.output}`;
    } else {
      toolCall = {
        tool: toolName,
        params: (callArgs ?? {}) as Record<string, unknown>,
        result: rawResult,
      };
      if (llmResult !== undefined) {
        toolCall.resultLlm = llmResult;
      }
    }

    await this.sessionManager.appendMessage(ctx.sessionId!, {
      from: ctx.agent!.id,
      content,
      timestamp: new Date().toISOString(),
      isHuman: false,
      tool_calls: toolCall ? [toolCall] : undefined,
    });
  }

  private emitToolLifecycle(
    phase: 'request' | 'start',
    toolName: string,
    toolCallId: string,
    message: string,
    args: unknown,
    ctx: ExecutionContext
  ): void {
    emitEvent({
      kind: 'tool',
      toolName,
      toolCallId,
      toolPhase: phase,
      message,
      toolResult: this.support.buildPendingToolRuntimePayload(toolName, phase, args),
    } as RuntimeStreamEvent);
  }

  private buildExecutionContext(ctx: ExecutionContext, contextFiles?: string[]) {
    return {
      agentId: ctx.agent!.id,
      workspaceRoot: ctx.workspaceRoot,
      currentFiles: contextFiles,
      history: [],
    };
  }

  private prepareExecutionOutput(
    execResult: { ok: boolean; result?: unknown; error?: string },
    toolName: string
  ) {
    const fileChanges = execResult.ok ? this.support.extractFileChanges(execResult.result) : [];
    const strippedResult =
      fileChanges.length > 0 ? this.support.stripFileChanges(execResult.result) : execResult.result;
    const tool = this.toolManager.get(toolName);
    const llmResult =
      execResult.ok && tool?.formatForLlm ? tool.formatForLlm(strippedResult) : strippedResult;
    const outputText = execResult.ok
      ? this.support.serialise(llmResult)
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

    const denial = this.support.classifyToolDenial(execResult.ok, strippedResult, outputText);
    const resultLlm = execResult.ok && tool?.formatForLlm ? outputText : undefined;
    return {
      ok: execResult.ok,
      fileChanges,
      strippedResult,
      llmResult,
      outputText,
      persistedToolResult,
      persistedLlmResult,
      resultLlm,
      denial,
    };
  }

  private buildToolEvent(
    toolName: string,
    args: unknown,
    processed: {
      ok: boolean;
      strippedResult: unknown;
      outputText: string;
      resultLlm?: string;
      denial?: ToolDenial;
    }
  ) {
    const outcome = this.resolveOutcome(processed.denial, processed.ok);
    const toolPhase = this.resolveToolPhase(processed.denial, outcome);
    const toolEventMessage =
      processed.denial?.message ??
      (outcome === 'result'
        ? this.support.formatToolResultPreview(processed.outputText)
        : processed.outputText);
    const toolEventPayload = this.support.buildToolRuntimePayload(
      toolName,
      outcome,
      args,
      this.support.buildToolCommandResponse(
        toolName,
        toolEventMessage,
        outcome === 'result' ? processed.strippedResult : processed.outputText,
        processed.denial
      ),
      processed.denial,
      processed.resultLlm
    );
    return {
      toolPhase,
      toolEventMessage,
      toolEventPayload,
      toolDenial: processed.denial ? this.support.toToolDenialEvent(processed.denial) : undefined,
    };
  }

  private resolveOutcome(
    denial: ToolDenial | undefined,
    ok: boolean
  ): ToolRuntimePayloadEvent['outcome'] {
    if (denial) return 'denied';
    return ok ? 'result' : 'error';
  }

  private resolveToolPhase(
    denial: ToolDenial | undefined,
    outcome: ToolRuntimePayloadEvent['outcome']
  ): 'result' | 'error' | 'denied' {
    if (denial?.kind === 'policy-denied') return 'denied';
    if (outcome === 'result') return 'result';
    return 'error';
  }

  private emitFileChangeProposal(
    toolName: string,
    toolCallId: string,
    fileChanges: Array<{ filePath: string; oldContent: string; newContent: string }>,
    ctx: ExecutionContext
  ): void {
    if (fileChanges.length === 0) return;

    let additions = 0;
    let deletions = 0;
    for (const fc of fileChanges) {
      const oldLines = (fc.oldContent ?? '').split('\n');
      const newLines = (fc.newContent ?? '').split('\n');
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

    emitEvent({
      kind: 'code_edit_proposal',
      proposalId: `${toolName}-${toolCallId}`,
      agentName: ctx.agent!.name,
      description: `${ctx.agent!.name} edited ${fileChanges.length} file(s) via ${toolName}`,
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

  if (result && typeof result === 'object' && 'status' in result) {
    const data = (result as CoreCommandResponse).data;
    if (
      isHandoffRequest(data) ||
      isHireResult(data) ||
      isFindCapableAgentResult(data) ||
      isToolCatalogResult(data) ||
      isTeamListResult(data)
    ) {
      return data;
    }
  }

  return undefined;
}

export type { ToolDenial, ToolDenialKind } from './services/tool-dispatch-support-service.js';
