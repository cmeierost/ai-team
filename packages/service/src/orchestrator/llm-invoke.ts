/**
 * llm-invoke.ts — executes the LLM call for one turn.
 *
 * Receives prepared messages and tool definitions from send-turn.ts.
 * Owns:
 *   - tool policy system message injection
 *   - streaming filter (suppresses HANDOFF:/FORWARD_TO: directive lines)
 *   - streamChat / chatWithTools branching
 *
 * Returns the full response text and any structured tool results.
 * Does not touch session persistence, history, or handoff resolution.
 */

import { withAbortSignal } from '@ai-team/infrastructure';
import type {
  Agent,
  AgentTool,
  ChatCompletionMessageParam,
  Skill,
  StructuredToolResult,
} from '@ai-team/infrastructure';
import type { LlmToolDefinition } from '../tools/tool-manager.js';
import type { OrchestratorContext } from './pipeline-context.js';
import { dispatchToolCall } from './tool-dispatch.js';
import { extractStreamDeltaText } from './stream-events.js';

// ── Streaming filter ──────────────────────────────────────────────────────────
//
// Suppress HANDOFF:/FORWARD_TO: directive lines from the token stream without
// buffering the whole response — critical for real-time streaming to web clients
// via WebSocket.
//
// Strategy: at the start of each new line, buffer up to DIRECTIVE_MAX_LEN chars.
// As soon as we know the prefix cannot be a directive keyword, switch to "safe"
// mode and emit everything else immediately. On newline, make the final call and
// reset. The buffer is at most ~12 chars per line, so streaming latency impact
// is negligible.
//
// Works for both the CLI path (process.stdout → terminal) and the WebSocket path
// (process.stdout is patched by AiTeamService.invoke() to emit token events
// through the runtime event queue).

const HANDOFF_LINE_RE = /^\s*(?:HANDOFF|FORWARD_TO):/i;
const DIRECTIVE_HEADERS = ['HANDOFF:', 'FORWARD_TO:'] as const;

interface StreamFilterState {
  lineBuf: string;
  lineSafe: boolean;
}

type StreamTextSink = (text: string) => void;

function makeFilterState(): StreamFilterState {
  return { lineBuf: '', lineSafe: false };
}

function writeFiltered(delta: string, state: StreamFilterState, sink: StreamTextSink): void {
  let pos = 0;
  while (pos < delta.length) {
    if (state.lineSafe) {
      const nl = delta.indexOf('\n', pos);
      if (nl === -1) {
        sink(delta.slice(pos));
        return;
      }
      sink(delta.slice(pos, nl + 1));
      pos = nl + 1;
      state.lineSafe = false;
      state.lineBuf = '';
    } else {
      const ch = delta[pos++];
      if (ch === '\n') {
        state.lineBuf += ch;
        if (!HANDOFF_LINE_RE.test(state.lineBuf)) sink(state.lineBuf);
        state.lineBuf = '';
        state.lineSafe = false;
      } else {
        state.lineBuf += ch;
        const trimmedUpper = state.lineBuf.trimStart().toUpperCase();
        const startsWithDirective = DIRECTIVE_HEADERS.some((h) => trimmedUpper.startsWith(h));
        const couldBecomeDirective = DIRECTIVE_HEADERS.some((h) => h.startsWith(trimmedUpper));

        if (startsWithDirective) continue;

        if (trimmedUpper.length > 0 && !couldBecomeDirective) {
          state.lineSafe = true;
          sink(state.lineBuf);
          state.lineBuf = '';
        }
      }
    }
  }
}

function flushFilter(state: StreamFilterState, sink: StreamTextSink): void {
  if (state.lineBuf && !HANDOFF_LINE_RE.test(state.lineBuf)) {
    sink(state.lineBuf);
  }
  state.lineBuf = '';
  state.lineSafe = false;
}

// ── Tool policy system message ────────────────────────────────────────────────

function buildToolPolicyMessage(tools: AgentTool[]): ChatCompletionMessageParam {
  return {
    role: 'system',
    content:
      `Tool-calling is available. Registered tools: ${tools.map((t) => t.name).join(', ')}. ` +
      'Do not invent tool names. ' +
      'If the developer asks about what tools you can use, what files you can read/write, or access/permissions, call a relevant introspection tool (for example tool_list, tool_can_i, fs_who_can) before answering. ' +
      'If the developer asks to list or show visible/readable files (or file tree), call fs_tree on path "." (or requested path) first, then explain results.',
  };
}

// ── Public interface ──────────────────────────────────────────────────────────

export interface LlmInvokeParams {
  messages: ChatCompletionMessageParam[];
  tools: AgentTool[];
  toolDefs: LlmToolDefinition[];
  skills: Skill[];
  teamRoster: Agent[];
  ctx: OrchestratorContext;
}

export interface LlmInvokeResult {
  fullResponse: string;
  structuredResults: StructuredToolResult[];
}

export async function invokeLlm(params: LlmInvokeParams): Promise<LlmInvokeResult> {
  const { messages, tools, toolDefs, skills, teamRoster, ctx } = params;
  const { agent, hooks, llmService } = ctx;

  const state = makeFilterState();
  let fullResponse = '';
  const structuredResults: StructuredToolResult[] = [];
  const writeToken = (text: string) => {
    if (!text) {
      return;
    }
    if (hooks?.emit) {
      hooks.emit({ kind: 'token', text });
      return;
    }
    process.stdout.write(text);
  };

  const workingMessages: ChatCompletionMessageParam[] =
    toolDefs.length > 0 ? [buildToolPolicyMessage(tools), ...messages] : messages;

  try {
    if (toolDefs.length === 0) {
      const stream = await withAbortSignal(
        llmService.streamChat(agent, workingMessages, undefined, skills, teamRoster),
        hooks?.signal,
        'Chat streaming aborted.'
      );

      for await (const chunk of stream) {
        const delta = extractStreamDeltaText(chunk as Parameters<typeof extractStreamDeltaText>[0]);
        if (delta) {
          writeFiltered(delta, state, writeToken);
          fullResponse += delta;
        }
      }
      flushFilter(state, writeToken);
    } else {
      const result = await withAbortSignal(
        llmService.chatWithTools(
          agent,
          workingMessages,
          toolDefs,
          async (toolCall) => {
            const response = await dispatchToolCall(
              { toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, args: toolCall.args },
              ctx
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
          skills,
          teamRoster,
          8,
          (delta: string) => {
            if (delta) {
              writeFiltered(delta, state, writeToken);
              fullResponse += delta;
            }
          },
          ctx.instructions
        ),
        hooks?.signal,
        'Chat aborted.'
      );

      flushFilter(state, writeToken);
      if (result?.text) fullResponse = result.text;
    }
  } catch (err: unknown) {
    if (isAbortError(err)) throw err;
    throw err;
  }

  return { fullResponse, structuredResults };
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.message.includes('aborted');
  }
  return false;
}
