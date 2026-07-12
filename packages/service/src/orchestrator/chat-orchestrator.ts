/**
 * XStateChatOrchestrator — drop-in compatibility surface for chat loop migration.
 *
 * IMPORTANT:
 * - It intentionally exposes the exact same constructor + run() contract as ChatOrchestrator.
 * - It now uses the XState chat loop engine as the runtime control flow while
 *   preserving the legacy public API and behavior.
 */

import type {
  ChatMessage,
  ExecutionContext,
  IAgentManager,
  IEmitService,
  ILlmService,
  ISkillManager,
} from '@ai-team/core';
import { isCommandResponse } from '@ai-team/api-contracts';
import type { CommandResponse, RuntimeStreamEvent } from '@ai-team/api-contracts';

import type { SendTurnDeps } from '../workflow/send-turn-contracts.js';
import {
  PreLlmIntentResolver,
  type IPreLlmToolSource,
  type PreLlmIntent,
} from '../tools/pre-llm-intents.js';
import type { ResolvedPlugins, TurnResult } from './pipeline.js';
import { ToolDispatcher } from './tool-dispatch.js';
import { ToolSerializationService } from './services/tool-serialization-service.js';
import { HandoffOrchestrator } from './handoff.js';
import { runChatLoopWorkflowAsync } from '../workflow/chat-loop-engine.js';
import { runSendTurnMachineAsync } from '../workflow/send-turn-machine.js';
import type { SessionManager } from '../session-manager.js';
import type { ChatRuntimeHooks } from './hooks.js';
import { deriveRegistryKey } from '../command-registry-impl.js';

const AUTO_REACT_MESSAGE =
  '[Handoff received] You have just been handed this conversation. Review the briefing above, acknowledge the context, and ask the developer how they would like to proceed.';

export interface RunOptions {
  message: string;
  contextFiles?: string[];
  maxHops?: number;
}

export class ChatOrchestrator {
  private preLlmUserMessagePersisted = false;
  private preTurnUserMessageOverride: string | undefined;
  private lastManualOutput: string | undefined;

  private readonly toolDispatcher: ToolDispatcher;
  private readonly handoffOrchestrator: HandoffOrchestrator;
  private readonly hooks: ChatRuntimeHooks;
  private readonly agentManager: IAgentManager;
  private readonly sessionManager: SessionManager;
  private readonly llmService: ILlmService;
  private readonly serialization: ToolSerializationService;
  private readonly emitService: IEmitService;
  private readonly skillManager: ISkillManager;
  private readonly intentResolver: PreLlmIntentResolver;

  constructor(
    private readonly ctx: ExecutionContext,
    private readonly plugins: ResolvedPlugins,
    toolDispatcher: ToolDispatcher,
    handoffOrchestrator: HandoffOrchestrator,
    hooks: ChatRuntimeHooks,
    agentManager: IAgentManager,
    sessionManager: SessionManager,
    llmService: ILlmService,
    serialization: ToolSerializationService,
    emitService: IEmitService,
    skillManager: ISkillManager,
    toolSource?: IPreLlmToolSource
  ) {
    this.toolDispatcher = toolDispatcher;
    this.hooks = hooks;
    this.agentManager = agentManager;
    this.sessionManager = sessionManager;
    this.llmService = llmService;
    this.serialization = serialization;
    this.emitService = emitService;
    this.skillManager = skillManager;
    this.intentResolver = new PreLlmIntentResolver(toolSource ?? { getForAgent: () => [] });
    this.handoffOrchestrator = handoffOrchestrator;
  }

  async run(options: RunOptions): Promise<string> {
    this.preLlmUserMessagePersisted = false;
    this.preTurnUserMessageOverride = undefined;
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
          const effectiveMessage =
            hop === 0 && this.preTurnUserMessageOverride
              ? this.preTurnUserMessageOverride
              : message;

          const deps: SendTurnDeps = {
            sessionManager: this.sessionManager,
            llmService: this.llmService,
            skillManager: this.skillManager,
            agentManager: this.agentManager,
            runtimeHooks: this.hooks,
            emitService: this.emitService,
            toolDispatcher: this.toolDispatcher,
          };
          const output = await runSendTurnMachineAsync({
            userMessage: effectiveMessage,
            hop,
            ctx: this.ctx,
            plugins: this.plugins,
            deps,
            options: {
              skipPersist:
                hop > 0 ||
                effectiveMessage === AUTO_REACT_MESSAGE ||
                (hop === 0 && this.preLlmUserMessagePersisted),
            },
          });

          if (hop === 0) {
            this.preLlmUserMessagePersisted = false;
            this.preTurnUserMessageOverride = undefined;
          }

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
            (await this.agentManager.getAgentAsync(current.handoffTargetId)) ||
            (await this.agentManager.resolveAgentAsync(current.handoffTargetId)).find(
              (agent: any) => agent.id !== this.ctx.agent!.id
            );

          if (!targetKnown) {
            this.emitService.log(
              'warn',
              `Handoff requested to unknown agent "${current.handoffTargetId}" — staying with ${this.ctx.agent!.name}.`
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

          const switched = await this.handoffOrchestrator.executeHandoff(
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

          this.emitService.status('handoff', `${this.ctx.agent!.name} taking over.`);
          return { autoMessage: AUTO_REACT_MESSAGE };
        },
        runFailureAsync: async ({ error, state }) => {
          this.emitService.log('error', `[xstate-chat-loop] ${state}: ${error}`);
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
    if (slashResult.kind === 'consumed') return slashResult.text;
    if (slashResult.kind === 'continue') return undefined;

    // ── Scored pre-LLM tool intents (tool/workflow-driven) ─────────────────
    const preLlmIntentExecuted = await this.tryPreLlmIntent(message, contextFiles);
    if (preLlmIntentExecuted) {
      return undefined;
    }

    // ── Natural-language forward detection ──────────────────────────────────
    const nlResult = await this.handoffOrchestrator.tryNlForward(message, this.ctx);
    if (nlResult === null) return undefined;

    if (nlResult === 'forwarded') {
      // Engine routes this to prepareForwardedAutoReact → sendTurn.
      return 'forwarded';
    }

    return nlResult;
  }

  private async trySlashCommand(
    message: string
  ): Promise<{ kind: 'ignored' } | { kind: 'consumed'; text: string } | { kind: 'continue' }> {
    const trimmed = message.trim();
    if (!trimmed.startsWith('/')) return { kind: 'ignored' };

    const [rawKey, ...rest] = trimmed.slice(1).split(/\s+/);
    const key = (rawKey ?? '').toLowerCase();
    if (!key) {
      this.emitService.log('warn', 'Please enter a slash command name. Try /help.');
      return { kind: 'consumed', text: '' };
    }
    const rawArgs = rest.join(' ');

    const resolved = this.resolveSlashCommand(key);

    if (!resolved) {
      this.emitService.log('warn', `Unknown command: /${key}. Try /help.`);
      return { kind: 'consumed', text: '' };
    }

    const { executionResult, capturedEvents } = await this.executeSlashCommandWithCapture(
      resolved.dispatchKey,
      rawArgs
    );

    this.emitSlashCommandResponseEvent(key, rawArgs, executionResult);
    const promptForwardText = this.extractPromptForwardText(executionResult);
    this.handleSlashExecutionResult(executionResult);
    await this.persistSlashCommandExecution(key, rawArgs, executionResult, capturedEvents);
    if (promptForwardText) {
      this.preTurnUserMessageOverride = promptForwardText;
      return { kind: 'continue' };
    }
    return { kind: 'consumed', text: '' };
  }

  private resolveSlashCommand(
    rawKey: string
  ): { dispatchKey: string } | undefined {
    const direct = this.plugins.commandDispatcher.getCommand(rawKey);
    if (direct) {
      return { dispatchKey: rawKey };
    }

    const matched = this.plugins
      .commandDispatcher
      .getCommands({ chat: true })
      .find((descriptor) => {
        if (descriptor.key.toLowerCase() === rawKey) {
          return true;
        }

        return (descriptor.aliases ?? []).some((alias) => alias.toLowerCase() === rawKey);
      });

    if (!matched) {
      return undefined;
    }

    return {
      dispatchKey: deriveRegistryKey(matched.group, matched.key),
    };
  }

  private extractPromptForwardText(executionResult: unknown): string | undefined {
    if (!isCommandResponse(executionResult)) {
      return undefined;
    }

    const data = executionResult.data;
    if (!data || typeof data !== 'object') {
      return undefined;
    }

    const candidate = data as { source?: unknown; promptText?: unknown };
    if (candidate.source !== 'prompt') {
      return undefined;
    }

    if (typeof candidate.promptText !== 'string') {
      return undefined;
    }

    const trimmed = candidate.promptText.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private handleSlashExecutionResult(executionResult: CommandResponse | void): void {
    if (executionResult == null) return;

    // Only emit a log when there is a non-empty message. Data-only results are
    // already surfaced to the CLI via the tool event (emitSlashCommandResponseEvent).
    if (executionResult.message) {
      const level = executionResult.status === 'error' ? 'error' : 'info';
      this.sendMessage(executionResult.message, level);
    }

    const saveable = executionResult.saveable ?? executionResult.data ?? executionResult;
    this.lastManualOutput = this.serializeForStorage(saveable);
  }

  private sendMessage(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    this.emitService.log(level, message);
  }

  private async executeSlashCommandWithCapture(
    key: string,
    rawArgs: string
  ): Promise<{ executionResult: CommandResponse | void; capturedEvents: RuntimeStreamEvent[] }> {
    const executionResult = await this.plugins.commandDispatcher.dispatch(key, rawArgs, this.ctx);
    return { executionResult, capturedEvents: [] };
  }

  private formatCapturedSlashOutput(
    executionResult: unknown,
    capturedEvents: RuntimeStreamEvent[]
  ): string | undefined {
    const eventLines = capturedEvents
      .map((event: any) => {
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

    this.emitService.emit({
      kind: 'tool',
      toolName: `slash:${commandKey}`,
      toolPhase: executionResult.status === 'error' ? 'error' : 'result',
      message: executionResult.message || this.getExecutionResultText(executionResult) || '',
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
    return this.serialization.serializeForStorage(value);
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
      to: this.ctx.agent!.id,
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

    await this.sessionManager.appendMessage(this.ctx.sessionId!, persisted);
    this.ctx.history.push(persisted);
  }

  private extractAskAnswer(result: unknown): unknown {
    if (this.isAskAnswer(result)) {
      return result.answer;
    }
    return undefined;
  }

  private isAskAnswer(result: unknown): result is { answer: unknown } {
    return result !== null && typeof result === 'object' && 'answer' in result;
  }

  private async executePreLlmIntent(
    intent: PreLlmIntent,
    contextFiles?: string[]
  ): Promise<boolean> {
    if (intent.kind === 'tool') {
      await this.toolDispatcher.dispatch(
        {
          toolCallId: `pre-llm-intent-${Date.now()}`,
          toolName: intent.toolName,
          args: intent.args,
        },
        this.ctx,
        contextFiles
      );
      return true;
    }

    const askResult = await this.toolDispatcher.dispatch(
      {
        toolCallId: `pre-llm-intent-ask-${Date.now()}`,
        toolName: 'com_ask',
        args: intent.ask,
      },
      this.ctx,
      contextFiles
    );

    if (askResult.isError) {
      this.emitService.log(
        'warn',
        'Pre-LLM clarification failed; continuing without auto-tool execution.'
      );
      return false;
    }

    const answer = this.extractAskAnswer(askResult.result);
    const resolvedArgs = intent.resolveArgs(answer);
    if (!resolvedArgs) {
      if (intent.ask.kind !== 'confirm') {
        this.emitService.log(
          'warn',
          'Pre-LLM clarification did not produce executable tool arguments.'
        );
      }
      return false;
    }

    await this.toolDispatcher.dispatch(
      {
        toolCallId: `pre-llm-intent-${Date.now()}`,
        toolName: intent.toolName,
        args: resolvedArgs,
      },
      this.ctx,
      contextFiles
    );
    return true;
  }

  private async tryPreLlmIntent(message: string, contextFiles?: string[]): Promise<boolean> {
    const intent = await this.intentResolver.resolve(
      message,
      this.ctx,
      this.plugins.preLlmIntentProviders ?? []
    );
    if (!intent) return false;

    const executed = await this.executePreLlmIntent(intent, contextFiles);
    if (!executed) {
      return false;
    }

    await this.persistRegexIntentUserMessage(message);
    this.preLlmUserMessagePersisted = true;
    return true;
  }

  private async persistRegexIntentUserMessage(message: string): Promise<void> {
    const userMsg: ChatMessage = {
      timestamp: new Date().toISOString(),
      from: 'human',
      to: this.ctx.agent!.id,
      isHuman: true,
      content: message,
    };

    const generatedTitle = await this.sessionManager.appendMessage(
      this.ctx.sessionId!,
      userMsg,
      this.llmService
    );

    if (generatedTitle) {
      this.emitService.emit({
        kind: 'session_title_updated',
        sessionId: this.ctx.sessionId!,
        title: generatedTitle,
      });
    }

    this.ctx.history.push(userMsg);
  }
}
