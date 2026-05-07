/**
 * XStateChatOrchestrator — drop-in compatibility surface for chat loop migration.
 *
 * IMPORTANT:
 * - It intentionally exposes the exact same constructor + run() contract as ChatOrchestrator.
 * - It now uses the XState chat loop engine as the runtime control flow while
 *   preserving the legacy public API and behavior.
 */

import type { ChatMessage } from '@ai-team/core';
import { isCommandResponse } from '@ai-team/api-contracts';
import type { CommandResponse, RuntimeStreamEvent } from '@ai-team/api-contracts';

import { emitLog, emitStatus } from './stream-events.js';
import { resolvePreLlmIntent } from '../tools/pre-llm-intents.js';
import { dispatchToolCall } from './tool-dispatch.js';
import { executeHandoff, tryNlForward } from './handoff.js';
import type { OrchestratorContext } from './pipeline-context.js';
import type { ResolvedPlugins, TurnResult } from './pipeline.js';
import { runChatLoopWorkflowAsync } from '../workflow/xstate-chat-loop-engine.js';
import { runSendTurnMachineAsync } from '../workflow/send-turn-machine.js';

const AUTO_REACT_MESSAGE =
  '[Handoff received] You have just been handed this conversation. Review the briefing above, acknowledge the context, and ask the developer how they would like to proceed.';

export interface RunOptions {
  message: string;
  contextFiles?: string[];
  maxHops?: number;
}

export class XStateChatOrchestrator {
  constructor(
    private readonly ctx: OrchestratorContext,
    private readonly plugins: ResolvedPlugins
  ) {}

  async run(options: RunOptions): Promise<string> {
    let lastTurnResult: TurnResult | undefined;
    let wasForwardedInPreturn = false;

    const workflowOutput = await runChatLoopWorkflowAsync(
      {
        message: options.message,
        maxHops: options.maxHops,
        autoReactMessage: AUTO_REACT_MESSAGE,
      },
      {
        runPreturnInterceptorsAsync: async ({ message }) => {
          const preturn = await this.tryPreTurnInterceptors(message, options.contextFiles);
          if (preturn === undefined) return { outcome: 'continue' as const };
          if (preturn === 'forwarded') {
            wasForwardedInPreturn = true;
            return {
              outcome: 'forwarded' as const,
              autoMessage: AUTO_REACT_MESSAGE,
            };
          }
          return {
            outcome: 'consumed' as const,
            text: preturn,
          };
        },
        runSendTurnAsync: async ({ message, hop }) => {
          const output = await runSendTurnMachineAsync({
            userMessage: message,
            hop,
            ctx: this.ctx,
            plugins: this.plugins,
            options: {
              skipPersist: hop > 0 || message === AUTO_REACT_MESSAGE,
            },
          });

          lastTurnResult = output.turnResult;
          return output.chatResult;
        },
        runPostTurnResolutionAsync: async () => {
          const current = lastTurnResult;
          if (!current?.handedOff || !current.handoffTargetId) {
            return {
              outcome: 'normal_complete' as const,
            };
          }

          const targetKnown =
            (await this.ctx.agentManager.getAgentAsync(current.handoffTargetId)) ||
            (await this.ctx.agentManager.resolveAgentAsync(current.handoffTargetId)).find(
              (agent) => agent.id !== this.ctx.agent.id
            );

          if (!targetKnown) {
            emitLog(
              this.ctx.hooks,
              'warn',
              `Handoff requested to unknown agent "${current.handoffTargetId}" — staying with ${this.ctx.agent.name}.`
            );
            return {
              outcome: 'normal_complete' as const,
              handoffNote: current.handoffNote,
              handoffTargetId: current.handoffTargetId,
              handoffTargetSessionId: current.handoffTargetSessionId,
            };
          }

          return {
            outcome: 'handoff_required' as const,
            handoffTargetId: current.handoffTargetId,
            handoffTargetSessionId: current.handoffTargetSessionId,
            handoffNote: current.handoffNote,
          };
        },
        runHandoffTransitionAsync: async ({ handoff }) => {
          if (!handoff.handoffTargetId) return {};

          const switched = await executeHandoff(
            this.ctx,
            handoff.handoffTargetId,
            handoff.handoffTargetSessionId,
            handoff.handoffNote
          );

          if (!switched) {
            throw new Error(
              `Handoff requested to unknown agent "${handoff.handoffTargetId}" and could not be executed.`
            );
          }

          emitStatus(this.ctx.hooks, 'handoff', `${this.ctx.agent.name} taking over.`);
          return { autoMessage: AUTO_REACT_MESSAGE };
        },
        runFailureAsync: async ({ error, state }) => {
          emitLog(this.ctx.hooks, 'error', `[xstate-chat-loop] ${state}: ${error}`);
        },
      }
    );

    if (workflowOutput.status === 'failed') {
      throw new Error(workflowOutput.error ?? 'Chat workflow failed');
    }

    if (wasForwardedInPreturn) {
      return '';
    }

    return workflowOutput.text;
  }

  private async tryPreTurnInterceptors(
    message: string,
    contextFiles?: string[]
  ): Promise<string | undefined> {
    // ── Slash command intercept ─────────────────────────────────────────────
    const slashResult = await this.trySlashCommand(message);
    if (slashResult !== null) return slashResult;

    // ── Deterministic regex tool intents (pre-LLM) ─────────────────────────
    const regexIntentResult = await this.tryRegexToolIntent(message, contextFiles);
    if (regexIntentResult !== null) return regexIntentResult;

    // ── Natural-language forward detection ──────────────────────────────────
    const nlResult = await tryNlForward(message, this.ctx);
    if (nlResult === null) return undefined;

    if (nlResult === 'forwarded') {
      // Engine routes this to prepareForwardedAutoReact → sendTurn.
      return 'forwarded';
    }

    return nlResult;
  }

  private async trySlashCommand(message: string): Promise<string | null> {
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) return null;

    const [rawKey, ...rest] = trimmed.slice(1).split(/\s+/);
    const key = (rawKey ?? '').toLowerCase();
    if (!key) {
      emitLog(this.ctx.hooks, 'warn', 'Please enter a slash command name. Try /help.');
      return '';
    }
    const rawArgs = rest.join(' ');

    const command = this.plugins.slashCommands.find(
      (c) => c.key === key || c.aliases?.includes(key)
    );

    if (!command) {
      emitLog(this.ctx.hooks, 'warn', `Unknown command: /${key}. Try /help.`);
      return '';
    }

    const { executionResult, capturedEvents } = await this.executeSlashCommandWithCapture(
      command,
      rawArgs
    );

    this.emitSlashCommandResponseEvent(key, rawArgs, executionResult);
    this.handleSlashExecutionResult(executionResult);
    await this.persistSlashCommandExecution(key, rawArgs, executionResult, capturedEvents);
    return '';
  }

  private handleSlashExecutionResult(executionResult: CommandResponse | void): void {
    if (executionResult == null) return;

    const level = executionResult.status === 'error' ? 'error' : 'info';
    this.sendMessage(executionResult.message, level);

    const saveable = executionResult.saveable ?? executionResult.data ?? executionResult;
    this.ctx.lastManualOutput = this.serializeForStorage(saveable);
  }

  private sendMessage(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    emitLog(this.ctx.hooks, level, message);
  }

  private async executeSlashCommandWithCapture(
    command: ResolvedPlugins['slashCommands'][number],
    rawArgs: string
  ): Promise<{ executionResult: CommandResponse | void; capturedEvents: RuntimeStreamEvent[] }> {
    const capturedEvents: RuntimeStreamEvent[] = [];
    const originalEmit = this.ctx.hooks.emit;

    if (originalEmit) {
      this.ctx.hooks.emit = (event) => {
        capturedEvents.push(event);
        originalEmit(event);
      };
    }

    try {
      const rawResult = await command.execute(rawArgs, this.ctx, {
        invocationSurface: 'slash',
        workspaceRoot: this.ctx.workspaceRoot,
        agentId: this.ctx.agent.id,
      });
      const executionResult = this.toCommandResponse(rawResult, command.key);
      return { executionResult, capturedEvents };
    } catch (error) {
      return {
        executionResult: {
          status: 'error',
          message: `Command /${command.key} failed: ${this.toErrorMessage(error)}`,
          error: {
            code: 'slash_command_failed',
            details: { command: command.key, args: rawArgs },
          },
        },
        capturedEvents,
      };
    } finally {
      if (originalEmit) {
        this.ctx.hooks.emit = originalEmit;
      }
    }
  }

  private formatCapturedSlashOutput(
    executionResult: unknown,
    capturedEvents: RuntimeStreamEvent[]
  ): string | undefined {
    const eventLines = capturedEvents
      .map((event) => {
        if (event.kind === 'log' && event.message) {
          return event.message;
        }
        if (event.kind === 'status' && event.message) {
          return event.message;
        }
        if (event.kind === 'progress' && event.message) {
          return event.message;
        }
        if (event.kind === 'tool') {
          const toolResultText =
            event.toolResult?.resultLlm ??
            event.toolResult?.commandResponse?.data ??
            event.toolResult?.commandResponse?.message ??
            (event.toolResult ? JSON.stringify(event.toolResult) : undefined);
          return event.message ?? (typeof toolResultText === 'string' ? toolResultText : undefined);
        }
        return undefined;
      })
      .filter((line): line is string => Boolean(line))
      .slice(0, 120);

    const executionResultText = this.getExecutionResultText(executionResult);

    if (!executionResultText && eventLines.length === 0) {
      return undefined;
    }

    return [executionResultText, ...eventLines]
      .filter((chunk): chunk is string => Boolean(chunk?.trim()))
      .join('\n\n')
      .slice(0, 20_000);
  }

  private getExecutionResultText(executionResult: unknown): string | undefined {
    if (executionResult === undefined) {
      return undefined;
    }

    if (isCommandResponse(executionResult)) {
      const saveable = executionResult.saveable ?? executionResult.data;
      const serializedSaveable = this.serializeForStorage(saveable);
      if (serializedSaveable) return serializedSaveable;
      return executionResult.message;
    }

    return this.serializeForStorage(executionResult);
  }

  private emitSlashCommandResponseEvent(
    commandKey: string,
    rawArgs: string,
    executionResult: CommandResponse | void
  ): void {
    if (!executionResult) {
      return;
    }

    this.ctx.hooks.emit?.({
      kind: 'tool',
      toolName: `slash:${commandKey}`,
      toolPhase: executionResult.status === 'error' ? 'error' : 'result',
      message: executionResult.message,
      toolResult: {
        toolName: `slash:${commandKey}`,
        outcome: executionResult.status === 'error' ? 'error' : 'result',
        request: rawArgs,
        commandResponse: executionResult,
      },
    });
  }

  private toCommandResponse(rawResult: unknown, commandKey: string): CommandResponse | void {
    if (rawResult === undefined) {
      return undefined;
    }

    if (isCommandResponse(rawResult)) {
      return rawResult;
    }

    return {
      status: 'ok',
      message: `Command /${commandKey} executed successfully.`,
      data: rawResult,
      saveable: rawResult,
    };
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private serializeForStorage(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private async persistSlashCommandExecution(
    key: string,
    rawArgs: string,
    executionResult: unknown,
    capturedEvents: RuntimeStreamEvent[]
  ): Promise<void> {
    const rendered = rawArgs.trim() ? `/${key} ${rawArgs.trim()}` : `/${key}`;
    const output = this.formatCapturedSlashOutput(executionResult, capturedEvents);
    const persisted: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: this.ctx.agent.id,
      isHuman: true,
      content: rendered,
      hiddenFromLlm: true,
      tool_calls: [
        {
          tool: `slash_${key}`,
          params: { args: rawArgs },
          result: {
            status: 'executed',
            command: rendered,
            output,
          },
        },
      ],
    };

    await this.ctx.sessionManager.appendMessage(this.ctx.sessionId, persisted);
    this.ctx.history.push(persisted);
  }

  private async tryRegexToolIntent(
    message: string,
    contextFiles?: string[]
  ): Promise<string | null> {
    const intent = resolvePreLlmIntent(message);
    if (!intent) return null;

    await this.persistRegexIntentUserMessage(message);
    await this.executeRegexToolIntent(intent.toolName, intent.args, contextFiles);
    return '';
  }

  private async persistRegexIntentUserMessage(message: string): Promise<void> {
    const userMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: this.ctx.agent.id,
      isHuman: true,
      content: message,
    };

    const generatedTitle = await this.ctx.sessionManager.appendMessage(
      this.ctx.sessionId,
      userMsg,
      this.ctx.llmService
    );

    if (generatedTitle) {
      this.ctx.hooks?.emit?.({
        kind: 'session_title_updated',
        sessionId: this.ctx.sessionId,
        title: generatedTitle,
      });
    }

    this.ctx.history.push(userMsg);
  }

  private async executeRegexToolIntent(
    toolName: string,
    args: unknown,
    contextFiles?: string[]
  ): Promise<void> {
    await dispatchToolCall(
      {
        toolCallId: `regex-intent-${Date.now()}`,
        toolName,
        args,
      },
      this.ctx,
      contextFiles
    );
  }
}
