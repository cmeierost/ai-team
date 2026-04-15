/**
 * ChatOrchestrator — the stateful session controller.
 *
 * One instance per active session. Accepts a single user message, runs
 * through the pipeline, handles handoff / hire / slash commands, and
 * returns when the turn is complete.
 *
 * The orchestrator itself knows nothing about:
 *   - HTTP, WebSockets, CLI readline — those are in the adapter layer.
 *   - Specific tool implementations — those are in core / service tools.
 *   - Storage format — delegated to SessionManager + ChatRuntimeHooks.
 *
 * To extend: register pipeline plugins via OrchestratorPlugins before calling run().
 */

import { emitStatus, emitLog } from './stream-events.js';
import { resolvePreLlmIntent } from '../tools/pre-llm-intents.js';
import { sendTurn } from './send-turn.js';
import { executeHandoff, tryNlForward } from './handoff.js';
import { dispatchToolCall } from './tool-dispatch.js';
import type { OrchestratorContext } from './pipeline-context.js';
import type { ResolvedPlugins } from './pipeline.js';
import type { ChatMessage } from '@ai-team/infrastructure';

/** Options for a single run() call. */
export interface RunOptions {
  /** Raw user message (may start with a slash command). */
  message: string;
  /** Files the user has open / selected in the IDE. */
  contextFiles?: string[];
  /**
   * Maximum number of automatic handoff hops allowed before the loop stops
   * and returns control to the caller. Prevents infinite handoff chains.
   * Default: 10.
   */
  maxHops?: number;
}

export class ChatOrchestrator {
  constructor(
    private readonly ctx: OrchestratorContext,
    private readonly plugins: ResolvedPlugins,
  ) {}

  /**
   * Execute one user turn. Returns the final response text.
   *
   * The loop continues across handoffs (agent switches) until:
   *   - The responding agent does NOT request a handoff, OR
   *   - The maximum hop count is reached.
   */
  async run(options: RunOptions): Promise<string> {
    const { message, maxHops = 10 } = options;

    const preTurnResult = await this.tryPreTurnInterceptors(message, options.contextFiles);
    if (preTurnResult !== undefined) return preTurnResult;

    // ── Turn loop (handles handoff chains) ──────────────────────────────────
    let currentMessage = message;
    let lastText = '';

    for (let hops = 0; hops < maxHops; hops++) {
      const result = await sendTurn(currentMessage, this.plugins, this.ctx);
      lastText = result.text;

      // ── Hire: reload agents, notify surface, continue ─────────────────────
      if (result.hired) {
        await this.ctx.agentManager.refreshAsync();
        emitLog(
          this.ctx.hooks,
          'info',
          `${this.ctx.agent.name} hired ${result.hired.name} (${result.hired.role}).`,
        );
        // Hiring is a side-effect — the turn is still considered complete.
        break;
      }

      // ── Handoff: switch agent, auto-react ──────────────────────────────────
      if (result.handedOff && result.handoffTargetId) {
        const switched = await executeHandoff(
          this.ctx,
          result.handoffTargetId,
          result.handoffTargetSessionId,
          result.handoffNote,
        );

        if (!switched) {
          emitLog(
            this.ctx.hooks,
            'warn',
            `Handoff requested to unknown agent "${result.handoffTargetId}" — staying with ${this.ctx.agent.name}.`,
          );
          break;
        }

        emitStatus(
          this.ctx.hooks,
          'handoff',
          `${this.ctx.agent.name} taking over.`,
        );

        // The new agent has the LLM briefing in their session history.
        // Auto-run a turn so the recipient reacts to the handoff context
        // and asks the developer how to proceed.  skipPersist keeps the
        // synthetic prompt out of the DB.
        const autoMsg = `[Handoff received] You have just been handed this conversation. `
          + `Review the briefing above, acknowledge the context, and ask the developer how they would like to proceed.`;
        const autoResult = await sendTurn(autoMsg, this.plugins, this.ctx, { skipPersist: true });
        lastText = autoResult.text;
        // If the auto-react itself triggers another handoff, the next
        // iteration of the loop will handle it.
        if (!autoResult.handedOff) break;
        continue;
      }

      // Normal turn — no handoff, we're done.
      break;
    }

    return lastText;
  }

  private async tryPreTurnInterceptors(
    message: string,
    contextFiles?: string[],
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
      // Handoff succeeded — auto-run a turn so the new agent reacts to
      // the briefing and asks the developer how to proceed.
      const autoMsg = `[Handoff received] You have just been handed this conversation. `
        + `Review the briefing above, acknowledge the context, and ask the developer how they would like to proceed.`;
      await sendTurn(autoMsg, this.plugins, this.ctx, { skipPersist: true });
      return '';
    }

    return nlResult;
  }

  // ── Slash command handling ──────────────────────────────────────────────────

  /**
   * Returns the response string if a slash command was matched, null otherwise.
   */
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
      c => c.key === key || c.aliases?.includes(key),
    );

    if (!command) {
      emitLog(this.ctx.hooks, 'warn', `Unknown command: /${key}. Try /help.`);
      return '';
    }

    await command.execute(rawArgs, this.ctx);
    return '';   // Slash commands handle their own output via hooks / stdout.
  }

  /**
   * Deterministic tool intent layer checked before LLM turn execution.
   *
   * IMPORTANT: tool execution is routed through dispatchToolCall(), which
   * preserves policy enforcement and dangerous-tool confirmation prompts.
   */
  private async tryRegexToolIntent(message: string, contextFiles?: string[]): Promise<string | null> {
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
    contextFiles?: string[],
  ): Promise<void> {
    await dispatchToolCall(
      {
        toolCallId: `regex-intent-${Date.now()}`,
        toolName,
        args,
      },
      this.ctx,
      contextFiles,
    );
  }

}

