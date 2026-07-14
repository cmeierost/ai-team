/**
 * llm-invoke.ts — executes the LLM call for one turn.
 *
 * Receives prepared messages and tool definitions from send-turn.ts.
 * Owns:
 *   - tool policy system message injection
 *   - streamChat / chatWithTools branching
 *
 * Returns the full response text and any structured tool results.
 * Does not touch session persistence, history, or handoff resolution.
 */

import type {
  Agent,
  ICommand,
  ILlmChatMessageParam,
  ILlmService,
  InstructionFile,
  LlmChatOptions,
  Skill,
  StructuredToolResult,
  IEmitService,
  ExecutionContext,
} from '@ai-team/core';
import { withAbortSignal } from '../utils/async-utils.js';
import type { LlmToolDefinition } from '../tooling/manager/tool-manager.js';
import type { ToolDispatcher } from '../workflow/runtime/tools/tool-dispatch.js';

import { LlmStreamDeltaExtractor, type LlmStreamChunk } from './stream-events.js';

const THINKING_TOKEN_PREFIX = '💭 ';
const DEFAULT_TOOL_LOOP_MAX_ROUNDS = 16;

type RuntimeLlmService = ILlmService & {
  streamChat(
    agent: Agent,
    messages: ILlmChatMessageParam[],
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[]
  ): AsyncIterable<unknown>;
  chatWithTools(
    agent: Agent,
    messages: ILlmChatMessageParam[],
    tools: LlmToolDefinition[],
    executeTool: (toolCall: {
      toolCallId: string;
      toolName: string;
      args: unknown;
    }) => Promise<{ toolCallId: string; toolName: string; result: unknown; isError?: boolean }>,
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[],
    maxToolRounds?: number,
    onToken?: (delta: string) => void,
    instructions?: InstructionFile[]
  ): Promise<{ text: string }>;
};

export interface LlmInvokeParams {
  messages: ILlmChatMessageParam[];
  tools: ICommand[];
  toolDefs: LlmToolDefinition[];
  skills: Skill[];
  teamRoster: Agent[];
  ctx: ExecutionContext;
}

export interface LlmInvokeResult {
  fullResponse: string;
  structuredResults: StructuredToolResult[];
}

export class LlmInvokeService {
  private readonly streamDeltaExtractor = new LlmStreamDeltaExtractor();

  constructor(
    private readonly llmService: ILlmService,
    private readonly emitService: IEmitService,
    private readonly toolDispatcher: ToolDispatcher
  ) {}

  async invokeAsync(params: LlmInvokeParams): Promise<LlmInvokeResult> {
    const { messages, tools, toolDefs, skills, teamRoster, ctx } = params;
    const { agent } = ctx;
    if (!agent) {
      throw new Error('LLM invocation requires an active agent.');
    }
    const runtimeLlm = this.llmService as RuntimeLlmService;

    let fullResponse = '';
    const structuredResults: StructuredToolResult[] = [];
    const writeToken = (text: string) => this.emitService.token(text);

    const workingMessages: ILlmChatMessageParam[] =
      toolDefs.length > 0 ? [this.buildToolPolicyMessage(tools), ...messages] : messages;

    try {
      if (toolDefs.length === 0) {
        const stream = (await withAbortSignal(
          Promise.resolve(
            runtimeLlm.streamChat(agent, workingMessages, undefined, skills, teamRoster)
          ),
          ctx.signal,
          'Chat streaming aborted.'
        )) as AsyncIterable<unknown>;

        for await (const chunk of stream) {
          const delta = this.streamDeltaExtractor.extractSegments(chunk as LlmStreamChunk);
          if (delta.reasoning) {
            writeToken(`${THINKING_TOKEN_PREFIX}${delta.reasoning}`);
          }
          if (delta.content) {
            writeToken(delta.content);
            fullResponse += delta.content;
          }
        }
      } else {
        const result = await withAbortSignal(
          runtimeLlm.chatWithTools(
            agent,
            workingMessages,
            toolDefs,
            async (toolCall) => {
              const response = await this.toolDispatcher.dispatch(
                {
                  toolCallId: toolCall.toolCallId,
                  toolName: toolCall.toolName,
                  args: toolCall.args,
                },
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
            DEFAULT_TOOL_LOOP_MAX_ROUNDS,
            (delta: string) => {
              if (delta) {
                if (delta.startsWith(THINKING_TOKEN_PREFIX)) {
                  writeToken(delta);
                  return;
                }
                writeToken(delta);
                fullResponse += delta;
              }
            },
            (ctx as any).instructions
          ),
          ctx.signal,
          'Chat aborted.'
        );

        // Do NOT overwrite fullResponse with result.text here.
        // fullResponse is accumulated across ALL rounds via the onToken delta callback,
        // capturing text both before and after every tool call.
        // result.text only contains the final round's assistantText — using it would
        // silently drop any text the model emitted before the last tool call.
        if (!fullResponse && result?.text) {
          // Some providers/tool-loop paths return only a final text payload and do
          // not invoke the onToken callback. Emit that fallback text so CLI/Web
          // clients still receive visible assistant output.
          writeToken(result.text);
          fullResponse = result.text;
        }
      }
    } catch (err: unknown) {
      if (this.isAbortError(err)) throw err;
      throw err;
    }

    return { fullResponse, structuredResults };
  }

  private buildToolPolicyMessage(tools: ICommand[]): ILlmChatMessageParam {
    const hasAskTool = tools.some((t) => t.metadata.group === 'com' && (t as any).name === 'ask');
    return {
      role: 'system',
      content:
        `Tool-calling is available. Registered tools: ${tools.map((t) => (t as any).name).join(', ')}. ` +
        'Do not invent tool names. ' +
        (hasAskTool
          ? 'If you need clarification or missing input from the developer, call com_ask instead of guessing. '
          : '') +
        'If the developer asks about what tools you can use, what files you can read/write, or access/permissions, call a relevant introspection tool (for example tool_list, tool_can_i, fs_who_can) before answering. ' +
        'If the developer asks to list or show visible/readable files (or file tree), call fs_tree on path "." (or requested path) first, then explain results.',
    };
  }

  private isAbortError(err: unknown): boolean {
    if (err instanceof Error) {
      return err.name === 'AbortError' || err.message.includes('aborted');
    }
    return false;
  }
}
