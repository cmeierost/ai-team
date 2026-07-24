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
  IToolDispatchService,
  ILlmInvokeService,
  LlmInvocationMetadata,
} from '@ai-team/core';
import { withAbortSignal } from '../utils/async-utils.js';
import type { LlmToolDefinition } from '../tooling/manager/tool-manager.js';
import { buildToolPolicyContent } from './tool-policy.js';

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
    }) => Promise<{
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
      terminal?: boolean;
    }>,
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[],
    maxToolRounds?: number,
    onToken?: (delta: string) => void,
    instructions?: InstructionFile[]
  ): Promise<{ text: string; metrics?: LlmInvocationMetadata }>;
  getInvocationIdentity?(): Pick<LlmInvocationMetadata, 'model' | 'provider'>;
};

export interface LlmInvokeParams {
  messages: ILlmChatMessageParam[];
  tools: ICommand[];
  toolDefs: LlmToolDefinition[];
  skills: Skill[];
  teamRoster: Agent[];
  instructions?: InstructionFile[];
  ctx: ExecutionContext;
}

export interface LlmInvokeResult {
  fullResponse: string;
  structuredResults: StructuredToolResult[];
  metrics: LlmInvocationMetadata;
}

export class LlmInvokeService implements ILlmInvokeService {
  private readonly streamDeltaExtractor = new LlmStreamDeltaExtractor();

  constructor(
    private readonly llmService: ILlmService,
    private readonly emitService: IEmitService,
    private readonly toolDispatcher: IToolDispatchService
  ) {}

  async invokeAsync(params: LlmInvokeParams): Promise<LlmInvokeResult> {
    const { messages, toolDefs, skills, teamRoster, instructions, ctx } = params;
    const { agent } = ctx;
    if (!agent) {
      throw new Error('LLM invocation requires an active agent.');
    }
    const runtimeLlm = this.llmService as RuntimeLlmService;

    let fullResponse = '';
    const startedAt = Date.now();
    let firstTokenAt: number | undefined;
    let providerMetrics: LlmInvocationMetadata = {};
    const structuredResults: StructuredToolResult[] = [];
    const writeToken = (text: string) => {
      if (text && firstTokenAt === undefined) firstTokenAt = Date.now();
      this.emitService.token(text);
    };

    const workingMessages: ILlmChatMessageParam[] =
      toolDefs.length > 0 ? [this.buildToolPolicyMessage(toolDefs), ...messages] : messages;

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
          providerMetrics = this.mergeMetrics(
            providerMetrics,
            this.extractMetrics(chunk, runtimeLlm.getInvocationIdentity?.())
          );
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
                terminal: response.terminal,
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
            instructions
          ),
          ctx.signal,
          'Chat aborted.'
        );
        providerMetrics = this.mergeMetrics(
          providerMetrics,
          result.metrics ?? runtimeLlm.getInvocationIdentity?.() ?? {}
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

    return {
      fullResponse,
      structuredResults,
      metrics: {
        ...providerMetrics,
        durationMs: Date.now() - startedAt,
        timeToFirstTokenMs:
          firstTokenAt === undefined ? undefined : Math.max(0, firstTokenAt - startedAt),
      },
    };
  }

  private extractMetrics(
    value: unknown,
    identity: Pick<LlmInvocationMetadata, 'model' | 'provider'> = {}
  ): LlmInvocationMetadata {
    const record = value && typeof value === 'object' ? (value as Record<string, any>) : {};
    const usage = record.usage && typeof record.usage === 'object' ? record.usage : {};
    const timings = record.timings && typeof record.timings === 'object' ? record.timings : {};
    const promptTokens = usage.prompt_tokens ?? usage.input_tokens;
    const completionTokens = usage.completion_tokens ?? usage.output_tokens;
    return {
      ...identity,
      model: typeof record.model === 'string' ? record.model : identity.model,
      promptTokens: typeof promptTokens === 'number' ? promptTokens : undefined,
      completionTokens: typeof completionTokens === 'number' ? completionTokens : undefined,
      totalTokens:
        typeof usage.total_tokens === 'number'
          ? usage.total_tokens
          : typeof promptTokens === 'number' && typeof completionTokens === 'number'
            ? promptTokens + completionTokens
            : undefined,
      providerDurationMs: this.firstFiniteNumber(
        record.provider_duration_ms,
        record.duration_ms,
        timings.total_ms,
        typeof timings.total === 'number' ? timings.total * 1000 : undefined
      ),
    };
  }

  private mergeMetrics(
    current: LlmInvocationMetadata,
    next: LlmInvocationMetadata
  ): LlmInvocationMetadata {
    return {
      ...current,
      ...next,
      promptTokens: this.sumOptional(current.promptTokens, next.promptTokens),
      completionTokens: this.sumOptional(current.completionTokens, next.completionTokens),
      totalTokens: this.sumOptional(current.totalTokens, next.totalTokens),
      providerDurationMs: this.sumOptional(
        current.providerDurationMs,
        next.providerDurationMs
      ),
    };
  }

  private sumOptional(left?: number, right?: number): number | undefined {
    return left === undefined ? right : right === undefined ? left : left + right;
  }

  private firstFiniteNumber(...values: unknown[]): number | undefined {
    return values.find((value): value is number => typeof value === 'number' && Number.isFinite(value));
  }

  private buildToolPolicyMessage(toolDefs: LlmToolDefinition[]): ILlmChatMessageParam {
    return {
      role: 'system',
      content: buildToolPolicyContent(toolDefs.map((tool) => tool.name)),
    };
  }

  private isAbortError(err: unknown): boolean {
    if (err instanceof Error) {
      return err.name === 'AbortError' || err.message.includes('aborted');
    }
    return false;
  }
}
