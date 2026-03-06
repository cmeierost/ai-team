/**
 * send-turn.ts — executes one LLM turn through the full pipeline.
 *
 * Responsibilities:
 *   1. Persist the user message to session history.
 *   2. Build the message list via IContextCompressor + IContextBuilder.
 *   3. Collect tool definitions via IToolResolver.
 *   4. Call llm.chatWithTools() with dispatchToolCall as the tool callback.
 *   5. Detect structured results from the tool dispatch and surface them.
 *   6. Return a TurnResult for the chat loop.
 */

import { withAbortSignal, isHandoffRequest, isHireResult } from '@ai-team/core';
import type { ChatMessage } from '@ai-team/core';
import type { OrchestratorContext } from './pipeline-context.js';
import type { ResolvedPlugins, TurnResult } from './pipeline.js';
import { dispatchToolCall, type ToolCallResponse } from './tool-dispatch.js';
import { extractStreamDeltaText, emitStatus } from './stream-events.js';

export async function sendTurn(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: OrchestratorContext,
): Promise<TurnResult> {
  const { agent, hooks, sessionManager, sessionId, llmService, skillManager } = ctx;

  // ── Abort guard ────────────────────────────────────────────────────────────
  if (hooks?.signal?.aborted) {
    throw new DOMException('Chat request aborted by user.', 'AbortError');
  }

  // ── 1. Persist user message ────────────────────────────────────────────────
  const userMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'human',
    to: agent.id,
    isHuman: true,
    content: userMessage,
  };
  await sessionManager.appendMessage(sessionId, userMsg);
  ctx.history.push(userMsg);

  emitStatus(hooks, 'thinking');

  // ── 2. Compress history + build message list ───────────────────────────────
  const compressed = await plugins.compressor.compress(ctx.history, ctx);
  const messages    = await plugins.contextBuilder.build(compressed, ctx);

  // ── 3. Inject enrichments ──────────────────────────────────────────────────
  for (const enricher of plugins.enrichers) {
    const extra = await enricher.enrich(ctx);
    if (extra) {
      messages.unshift({ role: 'system', content: extra });
    }
  }

  // ── 4. RAG supplement ──────────────────────────────────────────────────────
  const ragSnippet = await plugins.ragProvider.retrieve(userMessage, ctx);
  if (ragSnippet) {
    messages.push({ role: 'system', content: `## Relevant context\n${ragSnippet}` });
  }

  // ── 5. Configure LLM + collect tools ──────────────────────────────────────
  const skill       = ctx.skillManager.getSkill(ctx.agent.role ?? ctx.agent.id);
  const teamRoster  = ctx.agentManager.getAllAgents();
  const tools       = await plugins.toolResolver.resolve(ctx);
  const mcpTools    = await plugins.mcpGateway.discover();
  const allTools    = [...tools, ...mcpTools];

  // Select model (may mutate agent's llmOptions in place)
  await plugins.llmSelector.select(ctx);

  const toolDefs = allTools.map(t => ctx.toolManager.toSchema(t.name)).filter(Boolean);

  // ── 6. Build tool-use policy system message ────────────────────────────────
  let workingMessages = [...messages];
  if (toolDefs.length > 0) {
    workingMessages = [
      {
        role: 'system',
        content:
          `Tool-calling is available. Registered tools: ${allTools.map(t => t.name).join(', ')}. ` +
          'Do not invent tool names. ' +
          'If ask_human or ask_question is available, use it for required developer input.',
      },
      ...messages,
    ];
  }

  // ── 7. Call LLM ───────────────────────────────────────────────────────────
  let fullResponse = '';
  const structuredResults: ToolCallResponse['structured'][] = [];

  try {
    if (toolDefs.length === 0) {
      // Plain streaming, no tools
      const stream = await withAbortSignal(
        llmService.streamChat(agent, workingMessages, undefined, skill, teamRoster),
        hooks?.signal,
        'Chat streaming aborted.',
      );

      for await (const chunk of stream) {
        const delta = extractStreamDeltaText(chunk as Parameters<typeof extractStreamDeltaText>[0]);
        if (delta) {
          process.stdout.write(delta);
          fullResponse += delta;
        }
      }
    } else {
      // Tool-calling path
      const result = await withAbortSignal(
        llmService.chatWithTools(
          agent,
          workingMessages,
          toolDefs as import('@ai-team/core').LlmToolDefinition[],
          async (toolCall) => {
            const response = await dispatchToolCall(
              { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, args: toolCall.args },
              ctx,
            );

            if (response.structured) {
              structuredResults.push(response.structured);
            }

            return {
              toolCallId: response.toolCallId,
              toolName: response.toolName,
              result: response.result,
              isError: response.isError,
            };
          },
          undefined,
          skill,
          teamRoster,
          8,
          (delta: string) => {
            if (delta) {
              process.stdout.write(delta);
              fullResponse += delta;
            }
          },
        ),
        hooks?.signal,
        'Chat aborted.',
      );

      if (result?.text) fullResponse = result.text;
    }
  } catch (err: unknown) {
    if (isAbortError(err)) throw err;

    // LLM unavailable — surface useful error
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[LLM error] ${message}\n`);
    emitStatus(hooks, 'error', message);
    return { text: '', done: true };
  }

  process.stdout.write('\n');

  // ── 8. Persist agent reply ─────────────────────────────────────────────────
  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agent.id,
    content: fullResponse.trim(),
    isHuman: false,
  };
  await sessionManager.appendMessage(sessionId, agentMsg);
  ctx.history.push(agentMsg);

  await ctx.agentManager.recordInteraction(agent.id);

  // ── 9. Surface structured results to the caller ───────────────────────────
  const handoffReq = structuredResults.find(isHandoffRequest);
  const hireResult  = structuredResults.find(isHireResult);

  if (handoffReq && isHandoffRequest(handoffReq)) {
    return {
      text: fullResponse.trim(),
      done: false,
      handedOff: true,
      handoffTargetId: handoffReq.targetAgentId,
      handoffTargetSessionId: handoffReq.targetSessionId,
      handoffNote: handoffReq.briefingNote,
    };
  }

  if (hireResult && isHireResult(hireResult)) {
    return {
      text: fullResponse.trim(),
      done: false,
      hired: { agentId: hireResult.agentId, name: hireResult.name, role: hireResult.role },
    };
  }

  // ── 10. Delegate to IOutputHandler ────────────────────────────────────────
  const turnResult: TurnResult = { text: fullResponse.trim(), done: false };
  await plugins.outputHandler.handle(turnResult, ctx);

  return turnResult;
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.message.includes('aborted');
  }
  return false;
}
