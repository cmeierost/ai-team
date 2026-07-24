/**
 * LLM client - unified interface for GitHub Copilot and OpenAI-compatible providers
 *
 * GitHub Copilot path:
 *   - Gets a GitHub token via `gh auth token` (needs `copilot` scope)
 *   - Calls Copilot API (https://api.individual.githubcopilot.com)
 *   - Supports all Copilot models: Claude, GPT, Gemini, Grok, etc.
 *
 * OpenAI-compatible path:
 *   - Uses the configured baseUrl and API key
 *
 * Usage:
 *   const llm = new LlmService(workspaceRoot);
 *   await llm.initialize();
 *   const reply = await llm.chat(agent, [{ role: 'user', content: 'Hello' }]);
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions.js';
import path from 'node:path';
import type {
  LlmConfig,
  Agent,
  Skill,
  InstructionFile,
  ChatMessage,
  TeamConfig,
  IBackendLogService,
  ILlmSettingsResolver,
  ILlmService,
  LlmChatOptions,
  LlmDiagnosticReporter,
} from '@ai-team/core';
import { LlmProviderClient } from './llm-provider-client.js';
import { LlmSystemPromptBuilder } from './llm-system-prompt.js';
import { LlmTimeoutPolicy } from './llm-timeout-policy.js';
import { LlmToolEvidenceBuilder } from './llm-tool-evidence.js';
import { LlmTextToolParser } from './llm-text-tool-parser.js';
import { LlmTitleFallbackService } from './llm-title-fallback.js';
import { LlmProviderNormalizationService } from './llm-provider-normalization.js';

const STREAM_CHUNK_TIMEOUT_MS = 30_000;
const TITLE_REQUEST_TIMEOUT_MS = 8_000;
const MAX_AUTOMATIC_TOOL_FAILURE_RETRIES = 1;

// ============================================================================
// LlmService — high-level abstraction for any configured provider
// ============================================================================

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
  group?: string;
}

export interface LlmToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface LlmToolResult {
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
  terminal?: boolean;
}

export interface RuntimeToolEvidence {
  toolName: string;
  args: Record<string, unknown>;
  status: 'success' | 'failed' | 'partial' | 'mixed';
  content?: string;
  error?: string;
  sourceType: 'tool';
  confidence: 'direct';
}

export interface LlmToolChatResult {
  text: string;
  toolResults: LlmToolResult[];
}

import type { LlmLogPayload, SerializedError } from './llm-console-log.js';

/**
 * High-level LLM service that reads workspace config and exposes a
 * provider-agnostic chat interface.
 *
 * ```ts
 * const llm = new LlmService(workspaceRoot);
 * await llm.initialize();
 * const reply = await llm.chat(agent, [{ role: 'user', content: 'hi' }]);
 * ```
 */
export class LlmService implements ILlmService {
  private client!: OpenAI;
  private config!: LlmConfig;
  private providerRef?: string;
  private model!: string;
  private initialized = false;
  private readonly logDir: string;
  private logDirReady = false;
  private diagnosticReporter?: LlmDiagnosticReporter;
  private readonly providerClient = new LlmProviderClient();
  private readonly systemPromptBuilder = new LlmSystemPromptBuilder();
  private readonly timeoutPolicy = new LlmTimeoutPolicy();
  private readonly toolEvidenceBuilder = new LlmToolEvidenceBuilder();
  private readonly textToolParser = new LlmTextToolParser();
  private readonly titleFallbackService = new LlmTitleFallbackService();
  private readonly normalizationService = new LlmProviderNormalizationService();
  private readonly utils = new LlmServiceUtils(this.normalizationService);
  private readonly backendLogService: IBackendLogService;

  constructor(
    workspaceRoot: string,
    private readonly teamConfig: TeamConfig,
    private readonly llmSettingsResolver: ILlmSettingsResolver,
    backendLogService: IBackendLogService
  ) {
    this.logDir = path.join(workspaceRoot, '.ai-team', 'logs', 'llm');
    this.backendLogService = backendLogService;
  }

  setDiagnosticReporter(reporter?: LlmDiagnosticReporter): void {
    this.diagnosticReporter = reporter;
  }

  /**
   * Load workspace config + env and create the OpenAI client.
   * Must be called once before `chat()` / `streamChat()`.
   * @throws If no LLM config is found
   */
  async initialize(): Promise<void> {
    await this.initializeForChat();
  }

  /** Initialize only if not already done. Safe to call multiple times. */
  async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initializeForChat();
    }
  }

  async initializeForChat(
    agent?: Pick<Agent, 'llm'>,
    skill?: Pick<Skill, 'llm'>,
    runtimeOverrides?: LlmChatOptions
  ): Promise<LlmChatOptions> {
    if (!this.teamConfig) {
      throw new Error('No LLM configuration found. Run "ait init" to configure a provider.');
    }

    const resolved = this.llmSettingsResolver.resolveEffectiveLlmSettings(
      this.teamConfig,
      agent,
      skill,
      runtimeOverrides
    );
    this.config = resolved.config;
    this.providerRef = resolved.providerRef;
    this.model = this.providerClient.getDefaultModel(this.config);

    const apiKey = resolved.config.apiKey;

    this.client = this.providerClient.createLlmClient(this.config, apiKey);
    this.initialized = true;

    return resolved.options;
  }

  /** The resolved model name (e.g. "claude-sonnet-4.6") */
  get modelName(): string {
    this.assertReady();
    return this.model;
  }

  /** The provider name (e.g. "github-copilot") */
  get provider(): string {
    this.assertReady();
    return this.config.provider;
  }

  /** Provider registry key, if resolved from TeamConfig providers dictionary */
  get providerName(): string | undefined {
    this.assertReady();
    return this.providerRef;
  }

  /** The base URL used by the active provider (undefined for built-in providers like github-copilot) */
  get baseUrl(): string | undefined {
    this.assertReady();
    return this.config.baseUrl;
  }

  /** The underlying OpenAI client, for advanced use */
  get openai(): OpenAI {
    this.assertReady();
    return this.client;
  }

  // --------------------------------------------------------------------------
  // Chat
  // --------------------------------------------------------------------------

  /**
   * Send a chat completion request and return the full response text.
   *
   * @param agent - The agent whose persona is used as system prompt
   * @param messages - Conversation messages (user / assistant turns)
   * @param options - Optional overrides (model, maxTokens, temperature)
   * @param skills - Optional skills with role/specialization instructions
   * @param teamRoster - Optional list of all agents (injected into system prompt)
   * @returns The assistant's reply text
   */
  async chat(
    agent: Agent,
    messages: ChatCompletionMessageParam[],
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[]
  ): Promise<string> {
    this.assertReady();

    const requestTimeoutMs = this.timeoutPolicy.getChatRequestTimeoutMs(
      this.config,
      options?.model ?? this.model
    );

    const systemPrompt = this.systemPromptBuilder.build(agent, skills, teamRoster);
    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
    const start = Date.now();
    const logBase = this.buildLogBase('chat', agent, allMessages, options, skills, teamRoster);

    try {
      const requestPayload: ChatCompletionRequestPayload = {
        model: options?.model ?? this.model,
        messages: allMessages,
        max_tokens: options?.maxTokens,
        temperature: options?.temperature,
        top_p: options?.topP,
        presence_penalty: options?.presencePenalty,
        frequency_penalty: options?.frequencyPenalty,
        stop: options?.stop,
      };

      let response = await this.utils.withTimeout(
        this.utils.createChatCompletion(this.client, this.config, requestPayload),
        requestTimeoutMs,
        `LLM request timed out after ${requestTimeoutMs / 1000}s.`
      );

      let text = this.utils.extractChatCompletionText(response);

      if (!text) {
        const recovered = await this.utils.tryRecoverCompletionWithThinkingDisabled(
          this.client,
          this.config,
          requestPayload,
          response,
          requestTimeoutMs,
          `LLM request timed out after ${requestTimeoutMs / 1000}s.`
        );
        if (recovered) {
          response = recovered.response;
          text = recovered.text;
        }
      }

      if (!text) {
        throw new Error('LLM returned an empty response');
      }

      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        response: {
          text,
          raw: this.utils.safeJsonClone(response),
        },
      });

      return text;
    } catch (error) {
      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        error: this.utils.serializeError(error),
      });
      throw error;
    }
  }

  /**
   * Send a streaming chat completion request.
   *
   * @param agent - The agent whose persona is used as system prompt
   * @param messages - Conversation messages
   * @param options - Optional overrides
   * @param skills - Optional skills with role/specialization instructions
   * @param teamRoster - Optional list of all agents (injected into system prompt)
   * @returns An async iterable of content chunks
   */
  async streamChat(
    agent: Agent,
    messages: ChatCompletionMessageParam[],
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[]
  ) {
    this.assertReady();

    const requestTimeoutMs = this.timeoutPolicy.getChatRequestTimeoutMs(
      this.config,
      options?.model ?? this.model
    );

    const systemPrompt = this.systemPromptBuilder.build(agent, skills, teamRoster);
    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
    const start = Date.now();
    const logBase = this.buildLogBase('stream', agent, allMessages, options, skills, teamRoster);

    try {
      const stream = (await this.utils.withTimeout(
        this.utils.createChatCompletion(this.client, this.config, {
          model: options?.model ?? this.model,
          messages: allMessages,
          max_tokens: options?.maxTokens,
          temperature: options?.temperature,
          top_p: options?.topP,
          presence_penalty: options?.presencePenalty,
          frequency_penalty: options?.frequencyPenalty,
          stop: options?.stop,
          stream: true,
        }),
        requestTimeoutMs,
        `LLM stream setup timed out after ${requestTimeoutMs / 1000}s.`
      )) as AsyncIterable<ChatCompletionChunk>;

      return this.wrapStreamWithLogging(stream, logBase, start, STREAM_CHUNK_TIMEOUT_MS);
    } catch (error) {
      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        error: this.utils.serializeError(error),
      });
      throw error;
    }
  }

  async chatWithTools(
    agent: Agent,
    messages: ChatCompletionMessageParam[],
    tools: LlmToolDefinition[],
    executeTool: (toolCall: LlmToolCall) => Promise<LlmToolResult>,
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[],
    maxToolRounds: number = 8,
    onToken?: (token: string) => void,
    instructions?: InstructionFile[]
  ): Promise<LlmToolChatResult> {
    this.assertReady();

    const requestTimeoutMs = this.timeoutPolicy.getChatRequestTimeoutMs(
      this.config,
      options?.model ?? this.model
    );

    const systemPrompt = this.systemPromptBuilder.build(agent, skills, teamRoster, instructions);
    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const logBase = this.buildLogBase(
      'chat',
      agent,
      allMessages,
      options,
      skills,
      teamRoster,
      this.toChatCompletionTools(tools)
    );
    const start = Date.now();
    const collectedResults: LlmToolResult[] = [];
    const failedToolCallAttempts = new Map<string, number>();

    if (
      this.timeoutPolicy.shouldUseResponsesApiForToolLoop(this.config, options?.model ?? this.model)
    ) {
      logBase.request.api = 'responses';
      logBase.request.tools = this.toResponsesTools(tools);
      try {
        return await this.chatWithToolsViaResponses(
          allMessages,
          tools,
          executeTool,
          options,
          maxToolRounds,
          onToken,
          collectedResults,
          failedToolCallAttempts
        );
      } catch (error) {
        if (!this.utils.isResponsesApiFallbackError(error)) {
          throw error;
        }
        // Fall back to chat.completions for providers/endpoints that expose
        // GPT-5 model IDs but do not support Responses API tool loops.
        logBase.request.api = 'chat-completions';
        logBase.request.tools = this.toChatCompletionTools(tools);
      }
    }

    try {
      for (let round = 0; round < maxToolRounds; round++) {
        const stream = (await this.utils.withTimeout(
          this.utils.createChatCompletion(this.client, this.config, {
            model: options?.model ?? this.model,
            messages: allMessages,
            max_tokens: options?.maxTokens,
            temperature: options?.temperature,
            top_p: options?.topP,
            presence_penalty: options?.presencePenalty,
            frequency_penalty: options?.frequencyPenalty,
            stop: options?.stop,
            tools: this.toChatCompletionTools(tools),
            stream: true,
          }),
          requestTimeoutMs,
          `LLM request timed out after ${requestTimeoutMs / 1000}s.`
        )) as AsyncIterable<ChatCompletionChunk>;

        const toolCallMap = new Map<number, { id?: string; name: string; args: string }>();
        let assistantText = '';

        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
          const nextChunk = await this.utils.withTimeout(
            iterator.next(),
            STREAM_CHUNK_TIMEOUT_MS,
            `LLM tool stream timed out after ${STREAM_CHUNK_TIMEOUT_MS / 1000}s without receiving output.`
          );

          if (nextChunk.done) {
            break;
          }

          const chunk = nextChunk.value;
          const delta = chunk.choices?.[0]?.delta;
          const contentText = this.utils.extractDeltaText(delta?.content);
          const reasoningDelta = delta as
            | { reasoning?: unknown; reasoning_content?: unknown }
            | undefined;
          const reasoningText =
            this.utils.extractDeltaText(reasoningDelta?.reasoning_content)
            || this.utils.extractDeltaText(reasoningDelta?.reasoning);
          if (reasoningText) {
            onToken?.(`💭 ${reasoningText}`);
          }
          if (contentText) {
            assistantText += contentText;
            onToken?.(contentText);
          }

          const deltaToolCalls = (
            delta as
              | {
                  tool_calls?: Array<{
                    index?: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                }
              | undefined
          )?.tool_calls;

          if (!deltaToolCalls || deltaToolCalls.length === 0) {
            continue;
          }

          for (const toolCallDelta of deltaToolCalls) {
            const index = toolCallDelta.index ?? 0;
            const current = toolCallMap.get(index) || { name: '', args: '' };
            if (toolCallDelta.id) {
              current.id = toolCallDelta.id;
            }
            if (toolCallDelta.function?.name) {
              current.name += toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              current.args += toolCallDelta.function.arguments;
            }
            toolCallMap.set(index, current);
          }
        }

        let toolCalls = [...toolCallMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, value]) => ({
            id: value.id || randomUUID(),
            type: 'function' as const,
            function: {
              name: value.name,
              arguments: value.args || '{}',
            },
          }))
          .filter((toolCall) => toolCall.function.name.trim().length > 0);

        if (toolCalls.length === 0) {
          const fallbackCalls = this.textToolParser.parseTextToolCalls(
            assistantText,
            new Set(tools.map((tool) => tool.name))
          );

          if (fallbackCalls.length > 0) {
            toolCalls = fallbackCalls.map((fallback) => ({
              id: fallback.toolCallId,
              type: 'function' as const,
              function: {
                name: fallback.toolName,
                arguments: JSON.stringify(fallback.args ?? {}),
              },
            }));
          }
        }

        if (toolCalls.length === 0) {
          const text = assistantText.trim();
          if (!text) {
            throw new Error('LLM returned an empty response');
          }

          await this.writeLlmLog({
            ...logBase,
            durationMs: Date.now() - start,
            response: {
              text,
              raw: {
                toolResults: this.utils.safeJsonClone(collectedResults),
              },
            },
          });

          return {
            text,
            toolResults: collectedResults,
          };
        }

        allMessages.push({
          role: 'assistant',
          content: assistantText.length > 0 ? assistantText : null,
          tool_calls: toolCalls,
        } as ChatCompletionMessageParam);

        for (const toolCall of toolCalls) {
          if (toolCall.type !== 'function') {
            continue;
          }

          const toolName = toolCall.function.name;
          const rawArgs = toolCall.function.arguments ?? '{}';
          let args: unknown = {};

          try {
            args = rawArgs.trim().length > 0 ? JSON.parse(rawArgs) : {};
          } catch {
            args = {};
          }

          this.enforceToolFailureRetryLimit(
            failedToolCallAttempts,
            toolName,
            args,
            MAX_AUTOMATIC_TOOL_FAILURE_RETRIES
          );

          const toolResult = await executeTool({
            toolCallId: toolCall.id,
            toolName,
            args,
          });

          this.recordToolFailureAttempt(
            failedToolCallAttempts,
            toolName,
            args,
            Boolean(toolResult.isError)
          );

          collectedResults.push(toolResult);

          const payload = this.toolEvidenceBuilder.buildRuntimeToolEvidence(
            toolResult,
            this.utils.toRecord(args)
          );

          allMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(payload),
          } as ChatCompletionMessageParam);

          if (toolResult.terminal) {
            return { text: '', toolResults: collectedResults };
          }
        }
      }

      throw new Error(`Tool loop exceeded maximum rounds (${maxToolRounds})`);
    } catch (error) {
      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        response: {
          raw: {
            toolResults: this.utils.safeJsonClone(collectedResults),
          },
        },
        error: this.utils.serializeError(error),
      });
      throw error;
    }
  }

  private async chatWithToolsViaResponses(
    allMessages: ChatCompletionMessageParam[],
    tools: LlmToolDefinition[],
    executeTool: (toolCall: LlmToolCall) => Promise<LlmToolResult>,
    options: LlmChatOptions | undefined,
    maxToolRounds: number,
    onToken: ((token: string) => void) | undefined,
    collectedResults: LlmToolResult[],
    failedToolCallAttempts: Map<string, number>
  ): Promise<LlmToolChatResult> {
    const responseClient = (
      this.client as unknown as {
        responses?: { create?: (args: Record<string, unknown>) => Promise<unknown> };
      }
    ).responses;
    if (typeof responseClient?.create !== 'function') {
      throw new TypeError('Responses API is unavailable on the configured client.');
    }

    const model = options?.model ?? this.model;
    const requestTimeoutMs = this.timeoutPolicy.getChatRequestTimeoutMs(this.config, model);
    let inputItems = this.utils.mapChatMessagesToResponsesInput(allMessages);
    let previousResponseId: string | undefined;
    const responseTools = this.toResponsesTools(tools);

    let lastText = '';

    for (let round = 0; round < maxToolRounds; round++) {
      const request: Record<string, unknown> = {
        model,
        tools: responseTools,
      };

      if (previousResponseId) {
        request.previous_response_id = previousResponseId;
      }

      request.input = inputItems;

      if (options?.maxTokens !== undefined) {
        request.max_output_tokens = options.maxTokens;
      }
      if (options?.temperature !== undefined) {
        request.temperature = options.temperature;
      }

      const response = await this.utils.withTimeout(
        responseClient.create(request),
        requestTimeoutMs,
        `LLM request timed out after ${requestTimeoutMs / 1000}s.`
      );

      const roundText = this.utils.extractResponsesOutputText(response);
      if (roundText) {
        onToken?.(roundText);
        lastText = roundText;
      }

      const responseId = this.utils.extractResponsesResponseId(response);
      if (responseId) {
        previousResponseId = responseId;
      }

      const functionCalls = this.utils.extractResponseFunctionCalls(response);
      if (functionCalls.length === 0) {
        if (!lastText) {
          throw new Error('LLM returned an empty response');
        }
        return {
          text: lastText,
          toolResults: collectedResults,
        };
      }

      const toolOutputItems: Array<{
        type: 'function_call_output';
        call_id: string;
        output: string;
      }> = [];
      for (const call of functionCalls) {
        const args = this.utils.parseToolCallArguments(call.rawArgs);

        this.enforceToolFailureRetryLimit(
          failedToolCallAttempts,
          call.toolName,
          args,
          MAX_AUTOMATIC_TOOL_FAILURE_RETRIES
        );

        const toolResult = await executeTool({
          toolCallId: call.callId,
          toolName: call.toolName,
          args,
        });

        this.recordToolFailureAttempt(
          failedToolCallAttempts,
          call.toolName,
          args,
          Boolean(toolResult.isError)
        );

        collectedResults.push(toolResult);

        const payload = this.toolEvidenceBuilder.buildRuntimeToolEvidence(
          toolResult,
          this.utils.toRecord(args)
        );
        toolOutputItems.push({
          type: 'function_call_output',
          call_id: call.callId,
          output: JSON.stringify(payload),
        });

        if (toolResult.terminal) {
          return { text: '', toolResults: collectedResults };
        }
      }

      if (previousResponseId) {
        inputItems = toolOutputItems;
      } else {
        const outputItems = this.utils.extractResponseOutputItems(response);
        inputItems = [...inputItems, ...outputItems, ...toolOutputItems];
      }
    }

    throw new Error(`Tool loop exceeded maximum rounds (${maxToolRounds})`);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Low-level chat completion without an agent persona.
   * Useful during onboarding / init when no agents exist yet.
   *
   * @param systemPrompt - Custom system prompt
   * @param messages - Conversation messages
   * @param options - Optional overrides
   * @returns The assistant's reply text
   */
  async rawChat(
    systemPrompt: string,
    messages: ChatCompletionMessageParam[],
    options?: LlmChatOptions
  ): Promise<string> {
    this.assertReady();

    const requestTimeoutMs = this.timeoutPolicy.getChatRequestTimeoutMs(
      this.config,
      options?.model ?? this.model
    );

    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const start = Date.now();
    const logBase = this.buildRawLogBase('raw-chat', allMessages, options);

    try {
      const requestPayload: ChatCompletionRequestPayload = {
        model: options?.model ?? this.model,
        messages: allMessages,
        max_tokens: options?.maxTokens,
        temperature: options?.temperature,
        top_p: options?.topP,
        presence_penalty: options?.presencePenalty,
        frequency_penalty: options?.frequencyPenalty,
        stop: options?.stop,
      };

      let response = await this.utils.withTimeout(
        this.utils.createChatCompletion(this.client, this.config, requestPayload),
        requestTimeoutMs,
        `LLM request timed out after ${requestTimeoutMs / 1000}s.`
      );

      let text = this.utils.extractChatCompletionText(response);

      if (!text) {
        const recovered = await this.utils.tryRecoverCompletionWithThinkingDisabled(
          this.client,
          this.config,
          requestPayload,
          response,
          requestTimeoutMs,
          `LLM request timed out after ${requestTimeoutMs / 1000}s.`
        );
        if (recovered) {
          response = recovered.response;
          text = recovered.text;
        }
      }

      if (!text) {
        throw new Error('LLM returned an empty response');
      }

      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        response: {
          text,
          raw: this.utils.safeJsonClone(response),
        },
      });

      return text;
    } catch (error) {
      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        error: this.utils.serializeError(error),
      });
      throw error;
    }
  }

  /**
   * Low-level streaming chat completion without an agent persona.
   */
  async rawStreamChat(
    systemPrompt: string,
    messages: ChatCompletionMessageParam[],
    options?: LlmChatOptions
  ) {
    this.assertReady();

    const requestTimeoutMs = this.timeoutPolicy.getChatRequestTimeoutMs(
      this.config,
      options?.model ?? this.model
    );

    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const start = Date.now();
    const logBase = this.buildRawLogBase('raw-stream', allMessages, options);

    try {
      const stream = (await this.utils.withTimeout(
        this.utils.createChatCompletion(this.client, this.config, {
          model: options?.model ?? this.model,
          messages: allMessages,
          max_tokens: options?.maxTokens,
          temperature: options?.temperature,
          top_p: options?.topP,
          presence_penalty: options?.presencePenalty,
          frequency_penalty: options?.frequencyPenalty,
          stop: options?.stop,
          stream: true,
        }),
        requestTimeoutMs,
        `LLM stream setup timed out after ${requestTimeoutMs / 1000}s.`
      )) as AsyncIterable<ChatCompletionChunk>;

      return this.wrapStreamWithLogging(stream, logBase, start, STREAM_CHUNK_TIMEOUT_MS);
    } catch (error) {
      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        error: this.utils.serializeError(error),
      });
      throw error;
    }
  }

  /**
   * Generate a short title (≤5 words) for a conversation.
   * Requires `initialize()` to have been called first.
   */
  async generateTitle(messages: ChatMessage[]): Promise<string> {
    this.assertReady();
    const excerpts = messages
      .map((m) => (m.content ?? '').trim().slice(0, 200))
      .filter(Boolean)
      .map((text, i) => `Message ${i + 1}: ${text}`)
      .join('\n');
    if (!excerpts) return 'New Conversation';
    const prompt = `Write one short title for this conversation.

Use commit-message style:
- Imperative command form (e.g. "Fix ...", "Improve ...", "Create ...").
- Maximum 6 words.
- If clearly a feature, prefix with "FEAT:".
- If clearly a bug fix, prefix with "BUG:".
- Ignore greetings/small talk and focus on the main intent.
- Do not start with "Let" or "Let's".
- Do not return generic titles like "New Conversation".
- Return title only.

Examples:
- "title is not set after fallback" -> "BUG: Fix Title Fallback"
- "planning retiring agents and archiving old ones" -> "FEAT: Plan Agent Retirement"
- "write a SQL migration for users table" -> "Create Users Table Migration"

Conversation:
${excerpts}`;
    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'You generate concise conversation titles.' },
      { role: 'user', content: prompt },
    ];
    const start = Date.now();
    const logBase = this.buildRawLogBase('raw-chat', allMessages, {
      temperature: 0.3,
      maxTokens: 24,
    });

    try {
      const response = await this.utils.withTimeout(
        this.utils.createChatCompletion(this.client, this.config, {
          model: this.model,
          messages: allMessages,
          temperature: 0.3,
          max_tokens: 24,
        }),
        TITLE_REQUEST_TIMEOUT_MS,
        `Title request timed out after ${TITLE_REQUEST_TIMEOUT_MS / 1000}s.`
      );

      const text = this.utils
        .extractChatCompletionText(response)
        .replaceAll(/^["'\u201C\u201D]|["'\u201C\u201D]$/g, '')
        .trim();

      if (!text || this.titleFallbackService.isWeakGeneratedTitle(text)) {
        throw new Error('LLM returned an empty title response');
      }

      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        response: {
          text,
          raw: this.utils.safeJsonClone(response),
        },
      });

      return text;
    } catch (error) {
      const fallback = this.titleFallbackService.deriveFallbackTitle(messages);
      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        response: {
          text: fallback,
          raw: {
            mode: 'fallback',
          },
        },
        error: this.utils.serializeError(error),
      });
      return fallback;
    }
  }

  /**
   * Initialize from explicit config + apiKey (for use during init when
   * config.json may not exist yet).
   */
  initializeFromConfig(config: LlmConfig, apiKey?: string): void {
    this.config = config;
    this.providerRef = undefined;
    this.model = this.providerClient.getDefaultModel(config);
    this.client = this.providerClient.createLlmClient(config, apiKey);
    this.initialized = true;
  }

  private buildLogBase(
    mode: 'chat' | 'stream',
    agent: Agent,
    messages: ChatCompletionMessageParam[],
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[],
    tools?: unknown[]
  ): LlmLogBase {
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      provider: this.config.provider,
      model: options?.model ?? this.model,
      mode,
      agent: {
        id: agent.id,
        name: agent.name,
        role: agent.role,
      },
      request: {
        api: tools ? 'chat-completions' : undefined,
        messages: this.cloneMessages(messages),
        tools: tools ? this.utils.safeJsonClone(tools) : undefined,
        options: options ? this.utils.safeJsonClone(options) : undefined,
        skills: skills?.map((s) => ({
          name: s.name,
          filePath: s.filePath,
        })),
        teamRoster: teamRoster?.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
        })),
      },
    };
  }

  private buildRawLogBase(
    mode: 'raw-chat' | 'raw-stream',
    messages: ChatCompletionMessageParam[],
    options?: LlmChatOptions
  ): LlmLogBase {
    return {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      provider: this.config.provider,
      model: options?.model ?? this.model,
      mode,
      request: {
        messages: this.cloneMessages(messages),
        options: options ? this.utils.safeJsonClone(options) : undefined,
      },
    };
  }

  private cloneMessages(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
    return messages.map((msg) => this.utils.safeJsonClone(msg) as ChatCompletionMessageParam);
  }

  private toChatCompletionTools(tools: LlmToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters ?? { type: 'object', additionalProperties: true },
      },
    }));
  }

  private toResponsesTools(tools: LlmToolDefinition[]): Array<Record<string, unknown>> {
    return tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? { type: 'object', additionalProperties: true },
    }));
  }

  private wrapStreamWithLogging(
    stream: AsyncIterable<ChatCompletionChunk>,
    logBase: LlmLogBase,
    start: number,
    chunkTimeoutMs: number
  ): AsyncIterable<ChatCompletionChunk> {
    const self = this;
    async function* generator() {
      const snapshots: unknown[] = [];
      let text = '';
      try {
        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
          const nextChunk = await self.utils.withTimeout(
            iterator.next(),
            chunkTimeoutMs,
            `LLM stream timed out after ${chunkTimeoutMs / 1000}s without receiving output.`
          );
          if (nextChunk.done) {
            break;
          }
          const chunk = nextChunk.value;
          snapshots.push(self.utils.safeJsonClone(chunk));
          const delta = chunk.choices?.[0]?.delta;
          const reasoningDelta = delta as
            | { reasoning?: unknown; reasoning_content?: unknown }
            | undefined;
          text +=
            self.utils.extractDeltaText(delta?.content)
            || self.utils.extractDeltaText(reasoningDelta?.reasoning_content)
            || self.utils.extractDeltaText(reasoningDelta?.reasoning);
          yield chunk;
        }

        await self.writeLlmLog({
          ...logBase,
          durationMs: Date.now() - start,
          response: {
            text: text.trim(),
            raw: {
              chunkCount: snapshots.length,
              chunks: snapshots,
            },
          },
        });
      } catch (error) {
        await self.writeLlmLog({
          ...logBase,
          durationMs: Date.now() - start,
          response: {
            text: text.trim(),
            raw: {
              chunkCount: snapshots.length,
              chunks: snapshots,
            },
          },
          error: self.utils.serializeError(error),
        });
        throw error;
      }
    }

    return generator();
  }

  private async writeLlmLog(payload: LlmLogPayload): Promise<void> {
    // Route through unified backend logger — it handles console formatting
    // and file output based on log level configuration.
    this.backendLogService.write({
      source: 'llm',
      level: payload.error ? 'error' : 'info',
      ...payload,
    });

    try {
      if (!this.logDirReady) {
        await fs.mkdir(this.logDir, { recursive: true });
        this.logDirReady = true;
      }
      const safeTimestamp = payload.timestamp.replace(/[:]/g, '-');
      const fileName = `${safeTimestamp}-${payload.id}.json`;
      const filePath = path.join(this.logDir, fileName);
      await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Logging should never break chat flow.
    }
  }

  private assertReady(): void {
    if (!this.initialized) {
      throw new Error('LlmService not initialized. Call initialize() first.');
    }
  }

  private enforceToolFailureRetryLimit(
    failedToolCallAttempts: Map<string, number>,
    toolName: string,
    args: unknown,
    maxAutomaticRetries: number
  ): void {
    const key = this.buildToolFailureRetryKey(toolName, args);
    const failures = failedToolCallAttempts.get(key) ?? 0;
    if (failures <= maxAutomaticRetries) {
      return;
    }

    throw new Error(
      `Tool '${toolName}' failed repeatedly with the same arguments. ` +
        `Automatic retries are capped at ${maxAutomaticRetries}.`
    );
  }

  private recordToolFailureAttempt(
    failedToolCallAttempts: Map<string, number>,
    toolName: string,
    args: unknown,
    failed: boolean
  ): void {
    const key = this.buildToolFailureRetryKey(toolName, args);

    if (!failed) {
      failedToolCallAttempts.delete(key);
      return;
    }

    failedToolCallAttempts.set(key, (failedToolCallAttempts.get(key) ?? 0) + 1);
  }

  private buildToolFailureRetryKey(toolName: string, args: unknown): string {
    return `${toolName}:${this.stableSerializeForRetryKey(args)}`;
  }

  private stableSerializeForRetryKey(value: unknown): string {
    if (value === null || value === undefined) {
      return String(value);
    }

    if (typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map((entry) => this.stableSerializeForRetryKey(entry)).join(',')}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, entryValue]) =>
          `${JSON.stringify(key)}:${this.stableSerializeForRetryKey(entryValue)}`
      );

    return `{${entries.join(',')}}`;
  }
}

export type { ResolvedLlmSettings } from '@ai-team/core';

interface LlmLogBase {
  id: string;
  timestamp: string;
  provider: string;
  model: string;
  mode: 'chat' | 'stream' | 'raw-chat' | 'raw-stream';
  agent?: {
    id: string;
    name: string;
    role: string;
  };
  request: {
    api?: 'chat-completions' | 'responses';
    messages: ChatCompletionMessageParam[];
    tools?: unknown[];
    options?: LlmChatOptions;
    skills?: {
      name: string;
      filePath: string;
    }[];
    teamRoster?: {
      id: string;
      name: string;
      role: string;
    }[];
  };
}

type ResponseInputTextItem = {
  role: 'system' | 'user' | 'assistant';
  content: Array<{ type: 'input_text' | 'output_text'; text: string }>;
};

type ResponseFunctionCallOutputItem = {
  type: 'function_call_output';
  call_id: string;
  output: string;
};

type ResponseInputItem = ResponseInputTextItem | ResponseFunctionCallOutputItem;

type ChatCompletionRequestPayload = Record<string, unknown>;
class LlmServiceUtils {
  constructor(private readonly normalizationService: LlmProviderNormalizationService) {}

  safeJsonClone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value ?? null)) as T;
  }

  serializeError(error: unknown): SerializedError {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    return {
      message: typeof error === 'string' ? error : JSON.stringify(error),
    };
  }

  async withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  isResponsesApiFallbackError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return (
      normalized.includes('responses api is unavailable') ||
      normalized.includes('404') ||
      normalized.includes('not found') ||
      normalized.includes('unknown url') ||
      normalized.includes('unsupported') ||
      normalized.includes('invalid value') ||
      normalized.includes('supported values')
    );
  }

  extractDeltaText(delta: unknown): string {
    if (!delta) return '';
    if (typeof delta === 'string') return delta;
    if (Array.isArray(delta)) {
      return delta
        .map((part) => {
          if (typeof part === 'string') return part;
          if (
            typeof part === 'object' &&
            part &&
            'text' in part &&
            typeof (part as { text?: string }).text === 'string'
          ) {
            return (part as { text?: string }).text ?? '';
          }
          return '';
        })
        .join('');
    }
    return '';
  }

  mapChatMessagesToResponsesInput(messages: ChatCompletionMessageParam[]): ResponseInputItem[] {
    const out: ResponseInputItem[] = [];
    for (const message of messages) {
      if (message.role === 'system' || message.role === 'user' || message.role === 'assistant') {
        const text = this.extractMessageContentText(message.content);
        if (!text) {
          continue;
        }
        out.push({
          role: message.role,
          content: [{ type: this.resolveResponsesContentTypeForRole(message.role), text }],
        });
        continue;
      }

      if (message.role === 'tool') {
        const text = this.extractMessageContentText(message.content);
        const toolCallId = message.tool_call_id;
        if (!toolCallId || !text) {
          continue;
        }
        out.push({
          type: 'function_call_output',
          call_id: toolCallId,
          output: text,
        });
      }
    }

    return out;
  }

  extractResponseOutputItems(response: unknown): ResponseInputItem[] {
    const output = (response as { output?: unknown } | undefined)?.output;
    if (!Array.isArray(output)) {
      return [];
    }

    const items: ResponseInputItem[] = [];
    for (const item of output) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const record = item as Record<string, unknown>;
      const type = record.type;
      if (type === 'function_call') {
        const callId =
          typeof record.call_id === 'string' && record.call_id.trim().length > 0
            ? record.call_id
            : typeof record.id === 'string' && record.id.trim().length > 0
              ? record.id
              : randomUUID();
        const toolName =
          typeof record.name === 'string' && record.name.trim().length > 0
            ? record.name
            : undefined;
        const argumentsValue =
          typeof record.arguments === 'string'
            ? record.arguments
            : JSON.stringify(record.arguments ?? {});
        if (!toolName) {
          continue;
        }
        items.push({
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: `[function_call]\nname: ${toolName}\ncall_id: ${callId}\narguments: ${argumentsValue}`,
            },
          ],
        });
        continue;
      }

      if (type === 'message') {
        const text = this.extractResponsesMessageText(record);
        if (text) {
          items.push({
            role: 'assistant',
            content: [{ type: 'output_text', text }],
          });
        }
      }
    }

    return items;
  }

  extractResponsesResponseId(response: unknown): string | undefined {
    const id = (response as { id?: unknown } | undefined)?.id;
    if (typeof id === 'string' && id.trim().length > 0) {
      return id;
    }
    return undefined;
  }

  extractResponsesOutputText(response: unknown): string {
    const outputText = (response as { output_text?: unknown } | undefined)?.output_text;
    if (typeof outputText === 'string' && outputText.trim().length > 0) {
      return outputText.trim();
    }

    const output = (response as { output?: unknown } | undefined)?.output;
    if (!Array.isArray(output)) {
      return '';
    }

    const parts: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const record = item as Record<string, unknown>;
      if (record.type !== 'message') {
        continue;
      }
      const text = this.extractResponsesMessageText(record);
      if (text) {
        parts.push(text);
      }
    }

    return parts.join('\n').trim();
  }

  extractResponseFunctionCalls(
    response: unknown
  ): Array<{ callId: string; toolName: string; rawArgs: string }> {
    const output = (response as { output?: unknown } | undefined)?.output;
    if (!Array.isArray(output)) {
      return [];
    }

    const calls: Array<{ callId: string; toolName: string; rawArgs: string }> = [];
    for (const item of output) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const record = item as Record<string, unknown>;
      if (record.type !== 'function_call') {
        continue;
      }

      const toolName = typeof record.name === 'string' ? record.name.trim() : '';
      if (!toolName) {
        continue;
      }

      const callId =
        typeof record.call_id === 'string' && record.call_id.trim().length > 0
          ? record.call_id
          : typeof record.id === 'string' && record.id.trim().length > 0
            ? record.id
            : randomUUID();

      const rawArgs =
        typeof record.arguments === 'string'
          ? record.arguments
          : JSON.stringify(record.arguments ?? {});

      calls.push({ callId, toolName, rawArgs });
    }

    return calls;
  }

  parseToolCallArguments(rawArgs: string): unknown {
    const normalized = rawArgs.trim();
    if (!normalized) {
      return {};
    }

    try {
      return JSON.parse(normalized) as unknown;
    } catch {
      return {};
    }
  }

  toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  async createChatCompletion(
    client: OpenAI,
    config: LlmConfig,
    request: ChatCompletionRequestPayload
  ): Promise<unknown> {
    let currentRequest = this.normalizationService.normalizeMessagesForProvider(
      this.normalizeTokenParameter(request, config),
      config
    );
    const attempted = new Set<string>([this.stableRequestKey(currentRequest)]);
    let lastError: unknown;

    for (let i = 0; i < 5; i += 1) {
      try {
        return await client.chat.completions.create(currentRequest as never);
      } catch (error) {
        lastError = error;
        const fallbackCandidates = this.buildFallbackRequests(currentRequest, error);
        const nextRequest = fallbackCandidates.find((candidate) => {
          const key = this.stableRequestKey(candidate);
          if (attempted.has(key)) {
            return false;
          }
          attempted.add(key);
          return true;
        });

        if (!nextRequest) {
          throw error;
        }

        currentRequest = nextRequest;
      }
    }

    throw lastError;
  }

  async tryRecoverCompletionWithThinkingDisabled(
    client: OpenAI,
    config: LlmConfig,
    request: ChatCompletionRequestPayload,
    response: unknown,
    requestTimeoutMs: number,
    timeoutMessage: string
  ): Promise<{ response: unknown; text: string } | undefined> {
    const retryRequest = this.normalizationService.buildDisableThinkingFallbackRequest(
      config,
      request,
      response
    );
    if (!retryRequest) {
      return undefined;
    }

    try {
      const retryResponse = await this.withTimeout(
        this.createChatCompletion(client, config, retryRequest),
        requestTimeoutMs,
        timeoutMessage
      );

      const retryText = this.extractChatCompletionText(retryResponse);
      if (!retryText) {
        return undefined;
      }

      return {
        response: retryResponse,
        text: retryText,
      };
    } catch {
      return undefined;
    }
  }

  extractChatCompletionText(response: unknown): string {
    const choices = (response as { choices?: unknown[] } | undefined)?.choices;
    if (!Array.isArray(choices) || choices.length === 0) {
      return '';
    }

    for (const choice of choices) {
      const message = (choice as { message?: { content?: unknown } } | undefined)?.message;
      const messageText = this.extractMessageContentText(message?.content);
      if (messageText) {
        return messageText;
      }

      const directText = (choice as { text?: unknown } | undefined)?.text;
      if (typeof directText === 'string' && directText.trim().length > 0) {
        return directText.trim();
      }
    }

    return '';
  }

  private resolveResponsesContentTypeForRole(
    role: 'system' | 'user' | 'assistant'
  ): 'input_text' | 'output_text' {
    return role === 'assistant' ? 'output_text' : 'input_text';
  }

  private extractResponsesMessageText(record: Record<string, unknown>): string {
    const content = record.content;
    if (!Array.isArray(content)) {
      return '';
    }

    const parts: string[] = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }
      const item = part as Record<string, unknown>;
      if (
        item.type === 'output_text' &&
        typeof item.text === 'string' &&
        item.text.trim().length > 0
      ) {
        parts.push(item.text.trim());
        continue;
      }

      if (item.type === 'text' && typeof item.text === 'string' && item.text.trim().length > 0) {
        parts.push(item.text.trim());
        continue;
      }

      const textObject = item.text;
      if (textObject && typeof textObject === 'object') {
        const value = (textObject as Record<string, unknown>).value;
        if (typeof value === 'string' && value.trim().length > 0) {
          parts.push(value.trim());
        }
      }
    }

    return parts.join('\n').trim();
  }

  private extractMessageContentText(content: unknown): string {
    if (typeof content === 'string') {
      return content.trim();
    }

    if (content && typeof content === 'object') {
      const contentObject = content as { text?: unknown; value?: unknown; content?: unknown };

      if (typeof contentObject.text === 'string' && contentObject.text.trim().length > 0) {
        return contentObject.text.trim();
      }

      if (contentObject.text && typeof contentObject.text === 'object') {
        const nestedValue = (contentObject.text as { value?: unknown }).value;
        if (typeof nestedValue === 'string' && nestedValue.trim().length > 0) {
          return nestedValue.trim();
        }
      }

      if (typeof contentObject.value === 'string' && contentObject.value.trim().length > 0) {
        return contentObject.value.trim();
      }

      if (typeof contentObject.content === 'string' && contentObject.content.trim().length > 0) {
        return contentObject.content.trim();
      }
    }

    if (!Array.isArray(content)) {
      return '';
    }

    const parts: string[] = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') {
        continue;
      }

      const textValue = (part as { text?: unknown }).text;
      if (typeof textValue === 'string' && textValue.trim().length > 0) {
        parts.push(textValue.trim());
        continue;
      }

      const nested = (part as { content?: unknown }).content;
      if (typeof nested === 'string' && nested.trim().length > 0) {
        parts.push(nested.trim());
      }
    }

    return parts.join('\n').trim();
  }

  private buildFallbackRequests(
    request: ChatCompletionRequestPayload,
    error: unknown
  ): ChatCompletionRequestPayload[] {
    const fallbacks: ChatCompletionRequestPayload[] = [];
    const maxTokenFallback = this.buildMaxTokensFallbackRequest(request, error);
    if (maxTokenFallback) {
      fallbacks.push(maxTokenFallback);
    }
    fallbacks.push(...this.buildSamplingFallbackRequests(request, error));
    return fallbacks;
  }

  private buildMaxTokensFallbackRequest(
    request: ChatCompletionRequestPayload,
    error: unknown
  ): ChatCompletionRequestPayload | undefined {
    if (!this.isUnsupportedMaxTokensError(error)) {
      return undefined;
    }
    if (!Object.prototype.hasOwnProperty.call(request, 'max_tokens')) {
      return undefined;
    }

    const maxTokens = request.max_tokens;
    if (
      maxTokens === undefined ||
      Object.prototype.hasOwnProperty.call(request, 'max_completion_tokens')
    ) {
      return undefined;
    }

    const fallbackRequest: ChatCompletionRequestPayload = {
      ...request,
      max_completion_tokens: maxTokens,
    };
    delete fallbackRequest.max_tokens;
    return fallbackRequest;
  }

  private buildSamplingFallbackRequests(
    request: ChatCompletionRequestPayload,
    error: unknown
  ): ChatCompletionRequestPayload[] {
    const candidates: ChatCompletionRequestPayload[] = [];
    const hasTemperature =
      Object.prototype.hasOwnProperty.call(request, 'temperature') &&
      request.temperature !== undefined;
    const hasTopP =
      Object.prototype.hasOwnProperty.call(request, 'top_p') && request.top_p !== undefined;

    if (!hasTemperature && !hasTopP) {
      return candidates;
    }

    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const temperatureUnsupported =
      hasTemperature &&
      (message.includes('temperature') || message.includes('sampling parameter')) &&
      (message.includes('not supported') || message.includes('unsupported'));
    const topPUnsupported =
      hasTopP &&
      (message.includes('top_p') ||
        message.includes('top p') ||
        message.includes('sampling parameter')) &&
      (message.includes('not supported') || message.includes('unsupported'));

    if (!temperatureUnsupported && !topPUnsupported) {
      return candidates;
    }

    if (temperatureUnsupported) {
      const withoutTemperature: ChatCompletionRequestPayload = { ...request };
      delete withoutTemperature.temperature;
      candidates.push(withoutTemperature);
    }

    if (topPUnsupported) {
      const withoutTopP: ChatCompletionRequestPayload = { ...request };
      delete withoutTopP.top_p;
      candidates.push(withoutTopP);
    }

    const withoutSampling: ChatCompletionRequestPayload = { ...request };
    delete withoutSampling.temperature;
    delete withoutSampling.top_p;
    candidates.push(withoutSampling);

    return candidates;
  }

  private stableRequestKey(request: ChatCompletionRequestPayload): string {
    const sortedEntries = Object.entries(request).sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(Object.fromEntries(sortedEntries));
  }

  private normalizeTokenParameter(
    request: ChatCompletionRequestPayload,
    config: LlmConfig
  ): ChatCompletionRequestPayload {
    if (!Object.prototype.hasOwnProperty.call(request, 'max_tokens')) {
      return request;
    }
    if (Object.prototype.hasOwnProperty.call(request, 'max_completion_tokens')) {
      return request;
    }

    const maxTokens = request.max_tokens;
    if (maxTokens === undefined) {
      return request;
    }

    const model = typeof request.model === 'string' ? request.model : undefined;
    if (!this.shouldUseMaxCompletionTokens(config, model)) {
      return request;
    }

    const normalized: ChatCompletionRequestPayload = {
      ...request,
      max_completion_tokens: maxTokens,
    };
    delete normalized.max_tokens;
    return normalized;
  }

  private shouldUseMaxCompletionTokens(config: LlmConfig, model?: string): boolean {
    if (config.provider !== 'openai-compatible' || !config.baseUrl || !model) {
      return false;
    }

    try {
      return (
        new URL(config.baseUrl).hostname.toLowerCase() === 'api.openai.com' &&
        model.toLowerCase().startsWith('gpt-5')
      );
    } catch {
      return false;
    }
  }

  private isUnsupportedMaxTokensError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    return normalized.includes('unsupported parameter') && normalized.includes('max_tokens');
  }
}

export { type ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
