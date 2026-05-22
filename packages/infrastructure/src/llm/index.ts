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

import { execSync } from 'node:child_process';
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
  IConfigurationStorage,
  IEnvironmentStorage,
} from '@ai-team/core';
import {
  resolveEffectiveLlmSettings,
} from '@ai-team/core';
import type {
  LlmChatOptions,
  LlmDiagnosticMessage,
  LlmDiagnosticReporter,
} from '@ai-team/core';
import { ConfigurationStorage } from '../agent/configuration-storage.js';
import { EnvironmentStorage } from '../agent/environment-storage.js';

const GITHUB_COPILOT_API_URL = 'https://api.individual.githubcopilot.com';
const GITHUB_COPILOT_MODELS_URL = 'https://api.individual.githubcopilot.com/models';
const DEFAULT_COPILOT_MODEL = 'gpt-4o';
const COPILOT_MODEL_FALLBACK: Array<{
  id: string;
  name: string;
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
}> = [
  { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 68_000, maxPromptTokens: 68_000 },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 68_000, maxPromptTokens: 68_000 },
  {
    id: 'claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    contextWindow: 128_000,
    maxPromptTokens: 128_000,
  },
  {
    id: 'claude-3.7-sonnet',
    name: 'Claude 3.7 Sonnet',
    contextWindow: 128_000,
    maxPromptTokens: 128_000,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    contextWindow: 144_000,
    maxPromptTokens: 144_000,
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    contextWindow: 160_000,
    maxPromptTokens: 160_000,
  },
  { id: 'o1', name: 'o1', contextWindow: 128_000, maxPromptTokens: 128_000 },
  { id: 'o1-mini', name: 'o1-mini', contextWindow: 128_000, maxPromptTokens: 128_000 },
  { id: 'o3-mini', name: 'o3-mini', contextWindow: 128_000, maxPromptTokens: 128_000 },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    contextWindow: 173_000,
    maxPromptTokens: 173_000,
  },
].sort((a, b) => a.name.localeCompare(b.name));
const GITHUB_TOKEN_TIMEOUT_MS = 15_000;
const MODEL_FETCH_TIMEOUT_MS = 15_000;
const TEST_CONNECTION_TIMEOUT_MS = 20_000;
const DEFAULT_CHAT_REQUEST_TIMEOUT_MS = 30_000;
const OPENAI_GPT5_CHAT_REQUEST_TIMEOUT_MS = 90_000;
const STREAM_CHUNK_TIMEOUT_MS = 30_000;
const TITLE_REQUEST_TIMEOUT_MS = 8_000;

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
import { isLlmConsoleLogEnabled, writeLlmLogToConsole } from './llm-console-log.js';

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
export class LlmService {
  private workspaceRoot: string;
  private client!: OpenAI;
  private config!: LlmConfig;
  private providerRef?: string;
  private model!: string;
  private initialized = false;
  private logDir: string;
  private logDirReady = false;
  private diagnosticReporter?: LlmDiagnosticReporter;

  constructor(
    workspaceRoot: string,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage
  ) {
    this.workspaceRoot = workspaceRoot;
    this.logDir = path.join(this.workspaceRoot, '.ai-team', 'logs', 'llm');
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
    const teamConfig = await this.configurationStorage.loadEffectiveConfigAsync(this.workspaceRoot);
    if (!teamConfig) {
      throw new Error('No LLM configuration found. Run "ait init" to configure a provider.');
    }

    const resolved = resolveEffectiveLlmSettings(teamConfig, agent, skill, runtimeOverrides);
    this.config = resolved.config;
    this.providerRef = resolved.providerRef;
    this.model = getDefaultModel(this.config);

    const env = await this.environmentStorage.loadEnvFileAsync(this.workspaceRoot);
    const apiKeyResolution = resolveApiKeyFromEnv(env, resolved.apiKeyEnvVar);

    for (const diagnostic of buildApiKeyResolutionDiagnostics(
      apiKeyResolution,
      this.config,
      this.providerRef
    )) {
      this.emitDiagnostic(diagnostic);
    }

    const apiKey = apiKeyResolution.apiKey;

    this.client = createLlmClient(this.config, apiKey);
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

    const requestTimeoutMs = getChatRequestTimeoutMs(this.config, options?.model ?? this.model);

    const systemPrompt = buildSystemPrompt(agent, skills, teamRoster);
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

      let response = await withTimeout(
        createChatCompletion(this.client, this.config, requestPayload),
        requestTimeoutMs,
        `LLM request timed out after ${requestTimeoutMs / 1000}s.`
      );

      let text = extractChatCompletionText(response);

      if (!text) {
        const recovered = await tryRecoverCompletionWithThinkingDisabled(
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
          raw: safeJsonClone(response),
        },
      });

      return text;
    } catch (error) {
      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        error: serializeError(error),
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

    const requestTimeoutMs = getChatRequestTimeoutMs(this.config, options?.model ?? this.model);

    const systemPrompt = buildSystemPrompt(agent, skills, teamRoster);
    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
    const start = Date.now();
    const logBase = this.buildLogBase('stream', agent, allMessages, options, skills, teamRoster);

    try {
      const stream = (await withTimeout(
        createChatCompletion(this.client, this.config, {
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
        error: serializeError(error),
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

    const requestTimeoutMs = getChatRequestTimeoutMs(this.config, options?.model ?? this.model);

    const systemPrompt = buildSystemPrompt(agent, skills, teamRoster, instructions);
    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const logBase = this.buildLogBase('chat', agent, allMessages, options, skills, teamRoster);
    const start = Date.now();
    const collectedResults: LlmToolResult[] = [];

    if (shouldUseResponsesApiForToolLoop(this.config, options?.model ?? this.model)) {
      try {
        return await this.chatWithToolsViaResponses(
          allMessages,
          tools,
          executeTool,
          options,
          maxToolRounds,
          onToken,
          collectedResults
        );
      } catch (error) {
        if (!isResponsesApiFallbackError(error)) {
          throw error;
        }
        // Fall back to chat.completions for providers/endpoints that expose
        // GPT-5 model IDs but do not support Responses API tool loops.
      }
    }

    try {
      for (let round = 0; round < maxToolRounds; round++) {
        const stream = (await withTimeout(
          createChatCompletion(this.client, this.config, {
            model: options?.model ?? this.model,
            messages: allMessages,
            max_tokens: options?.maxTokens,
            temperature: options?.temperature,
            top_p: options?.topP,
            presence_penalty: options?.presencePenalty,
            frequency_penalty: options?.frequencyPenalty,
            stop: options?.stop,
            tools: tools.map((tool) => ({
              type: 'function' as const,
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters ?? {
                  type: 'object',
                  additionalProperties: true,
                },
              },
            })),
            stream: true,
          }),
          requestTimeoutMs,
          `LLM request timed out after ${requestTimeoutMs / 1000}s.`
        )) as AsyncIterable<ChatCompletionChunk>;

        const toolCallMap = new Map<number, { id?: string; name: string; args: string }>();
        let assistantText = '';

        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
          const nextChunk = await withTimeout(
            iterator.next(),
            STREAM_CHUNK_TIMEOUT_MS,
            `LLM tool stream timed out after ${STREAM_CHUNK_TIMEOUT_MS / 1000}s without receiving output.`
          );

          if (nextChunk.done) {
            break;
          }

          const chunk = nextChunk.value;
          const delta = chunk.choices?.[0]?.delta;
          const deltaText =
            extractDeltaText(delta?.content) ||
            extractDeltaText(
              (delta as { reasoning_content?: unknown } | undefined)?.reasoning_content
            );
          if (deltaText) {
            assistantText += deltaText;
            onToken?.(deltaText);
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
          const fallbackCalls = parseTextToolCalls(
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
                toolResults: safeJsonClone(collectedResults),
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

          const toolResult = await executeTool({
            toolCallId: toolCall.id,
            toolName,
            args,
          });

          collectedResults.push(toolResult);

          const payload = buildRuntimeToolEvidence(toolResult, toRecord(args));

          allMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(payload),
          } as ChatCompletionMessageParam);
        }
      }

      throw new Error(`Tool loop exceeded maximum rounds (${maxToolRounds})`);
    } catch (error) {
      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        response: {
          raw: {
            toolResults: safeJsonClone(collectedResults),
          },
        },
        error: serializeError(error),
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
    collectedResults: LlmToolResult[]
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
    const requestTimeoutMs = getChatRequestTimeoutMs(this.config, model);
    let inputItems = mapChatMessagesToResponsesInput(allMessages);
    let previousResponseId: string | undefined;
    const responseTools = tools.map((tool) => ({
      type: 'function' as const,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters ?? {
        type: 'object',
        additionalProperties: true,
      },
    }));

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

      const response = await withTimeout(
        responseClient.create(request),
        requestTimeoutMs,
        `LLM request timed out after ${requestTimeoutMs / 1000}s.`
      );

      const roundText = extractResponsesOutputText(response);
      if (roundText) {
        onToken?.(roundText);
        lastText = roundText;
      }

      const responseId = extractResponsesResponseId(response);
      if (responseId) {
        previousResponseId = responseId;
      }

      const functionCalls = extractResponseFunctionCalls(response);
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
        const args = parseToolCallArguments(call.rawArgs);
        const toolResult = await executeTool({
          toolCallId: call.callId,
          toolName: call.toolName,
          args,
        });
        collectedResults.push(toolResult);

        const payload = buildRuntimeToolEvidence(toolResult, toRecord(args));
        toolOutputItems.push({
          type: 'function_call_output',
          call_id: call.callId,
          output: JSON.stringify(payload),
        });
      }

      if (previousResponseId) {
        inputItems = toolOutputItems;
      } else {
        const outputItems = extractResponseOutputItems(response);
        inputItems = [...inputItems, ...outputItems, ...toolOutputItems];
      }
    }

    throw new Error(`Tool loop exceeded maximum rounds (${maxToolRounds})`);
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  /**
   * Convert stored ChatMessage history into OpenAI message format.
   *
   * @param history - Chat messages from JSONL history
   * @param agentId - The agent ID (messages from this agent become "assistant")
   * @returns OpenAI-compatible message array
   */
  static historyToMessages(history: ChatMessage[], agentId: string): ChatCompletionMessageParam[] {
    return history
      .filter((msg) => !msg.archived && !msg.hiddenFromLlm)
      .map((msg) => ({
        role: msg.from === 'human' ? ('user' as const) : ('assistant' as const),
        content: msg.content,
      }));
  }

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

    const requestTimeoutMs = getChatRequestTimeoutMs(this.config, options?.model ?? this.model);

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

      let response = await withTimeout(
        createChatCompletion(this.client, this.config, requestPayload),
        requestTimeoutMs,
        `LLM request timed out after ${requestTimeoutMs / 1000}s.`
      );

      let text = extractChatCompletionText(response);

      if (!text) {
        const recovered = await tryRecoverCompletionWithThinkingDisabled(
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
          raw: safeJsonClone(response),
        },
      });

      return text;
    } catch (error) {
      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        error: serializeError(error),
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

    const requestTimeoutMs = getChatRequestTimeoutMs(this.config, options?.model ?? this.model);

    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const start = Date.now();
    const logBase = this.buildRawLogBase('raw-stream', allMessages, options);

    try {
      const stream = (await withTimeout(
        createChatCompletion(this.client, this.config, {
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
        error: serializeError(error),
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
      const response = await withTimeout(
        createChatCompletion(this.client, this.config, {
          model: this.model,
          messages: allMessages,
          temperature: 0.3,
          max_tokens: 24,
        }),
        TITLE_REQUEST_TIMEOUT_MS,
        `Title request timed out after ${TITLE_REQUEST_TIMEOUT_MS / 1000}s.`
      );

      const text = extractChatCompletionText(response)
        .replaceAll(/^["'\u201C\u201D]|["'\u201C\u201D]$/g, '')
        .trim();

      if (!text || isWeakGeneratedTitle(text)) {
        throw new Error('LLM returned an empty title response');
      }

      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        response: {
          text,
          raw: safeJsonClone(response),
        },
      });

      return text;
    } catch (error) {
      const fallback = deriveFallbackTitle(messages);
      await this.writeLlmLog({
        ...logBase,
        durationMs: Date.now() - start,
        response: {
          text: fallback,
          raw: {
            mode: 'fallback',
          },
        },
        error: serializeError(error),
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
    this.model = getDefaultModel(config);
    this.client = createLlmClient(config, apiKey);
    this.initialized = true;
  }

  private buildLogBase(
    mode: 'chat' | 'stream',
    agent: Agent,
    messages: ChatCompletionMessageParam[],
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[]
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
        messages: this.cloneMessages(messages),
        options: options ? safeJsonClone(options) : undefined,
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
        options: options ? safeJsonClone(options) : undefined,
      },
    };
  }

  private cloneMessages(messages: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
    return messages.map((msg) => safeJsonClone(msg) as ChatCompletionMessageParam);
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
          const nextChunk = await withTimeout(
            iterator.next(),
            chunkTimeoutMs,
            `LLM stream timed out after ${chunkTimeoutMs / 1000}s without receiving output.`
          );
          if (nextChunk.done) {
            break;
          }
          const chunk = nextChunk.value;
          snapshots.push(safeJsonClone(chunk));
          const delta = chunk.choices?.[0]?.delta;
          text +=
            extractDeltaText(delta?.content) ||
            extractDeltaText(
              (delta as { reasoning_content?: unknown } | undefined)?.reasoning_content
            );
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
          error: serializeError(error),
        });
        throw error;
      }
    }

    return generator();
  }

  private async writeLlmLog(payload: LlmLogPayload): Promise<void> {
    if (isLlmConsoleLogEnabled()) {
      writeLlmLogToConsole(payload);
    }

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

  private emitDiagnostic(entry: LlmDiagnosticMessage): void {
    this.diagnosticReporter?.(entry);
  }
}

export function createLlmService(workspaceRoot: string): LlmService {
  return new LlmService(workspaceRoot, new ConfigurationStorage(), new EnvironmentStorage());
}

// ============================================================================
// System prompt builder
// ============================================================================

/**
 * Build a system prompt from an agent's persona and (optional) role/specialization instructions.
 *
 * The prompt combines:
 *  - Agent identity (name, role)
 *  - Agent's personality traits
 *  - Skill instructions (from the roles/*.md markdown body)
 *  - Agent's own markdown bio
 *  - Team roster (other agents in the workspace)
 *  - Workspace instruction files (.instructions.md)
 */
export function buildSystemPrompt(
  agent: Agent,
  skills?: Skill[],
  teamRoster?: Agent[],
  instructions?: InstructionFile[]
): string {
  const parts: string[] = [];

  // Identity
  parts.push(`You are ${agent.name}, a virtual AI team member.`);
  parts.push(`Your role: ${agent.role}`);
  if (agent.reportsTo) {
    const manager = teamRoster?.find((a) => a.id === agent.reportsTo);
    if (manager) {
      parts.push(`You report to ${manager.name} (${manager.role}).`);
    } else {
      parts.push(`You report to ${agent.reportsTo}.`);
    }
  }

  // Personality
  if (agent.personality) {
    const p = agent.personality;
    if (p.communication_style) {
      parts.push(`Communication style: ${p.communication_style}`);
    }
    if (p.expertise_level) {
      parts.push(`Expertise level: ${p.expertise_level}`);
    }
    if (typeof p.mentoring === 'boolean') {
      parts.push(`Mentoring posture: ${p.mentoring ? 'enabled' : 'disabled'}`);
    }

    parts.push('Personality behavior rules:');
    if (p.communication_style === 'supportive') {
      parts.push('- Be warm, friendly, and people-focused. Encourage and reassure.');
      parts.push('- Ask clarifying questions with empathy before deciding.');
    }
    if (p.communication_style === 'direct') {
      parts.push('- Be concise, decisive, and action-oriented.');
      parts.push('- Avoid filler and long introductions.');
    }
    if (p.communication_style === 'analytical') {
      parts.push('- Be structured and evidence-driven.');
      parts.push('- Use clear trade-offs, assumptions, and rationale.');
    }
    if (p.communication_style === 'strategic') {
      parts.push('- Focus on outcomes, priorities, and long-term implications.');
      parts.push('- Connect short-term actions to strategic goals.');
    }
    if (p.communication_style === 'collaborative') {
      parts.push('- Be cooperative, practical, and team-oriented.');
      parts.push('- Offer options and involve relevant teammates where useful.');
    }
    if (p.expertise_level === 'executive' || p.expertise_level === 'senior') {
      parts.push('- Show high competence and confidence. Be proactive and solution-driven.');
    }
    if (p.mentoring) {
      parts.push('- Explain decisions clearly and coach through next steps when helpful.');
    }
  }

  // Skill instructions (role + specializations from roles/*.md)
  const skillsWithInstructions = skills?.filter((s) => s.instructions) ?? [];
  if (skillsWithInstructions.length > 0) {
    parts.push('');
    parts.push('## Role Instructions');
    for (const skill of skillsWithInstructions) {
      parts.push(skill.instructions);
    }
  }

  // Agent's own bio / notes (from agents/*.md markdown body)
  if (agent.markdown?.trim()) {
    parts.push('');
    parts.push('## About You');
    parts.push(agent.markdown.trim());
  }

  // Workspace instruction files (.instructions.md)
  if (instructions && instructions.length > 0) {
    parts.push('');
    parts.push('## Workspace Instructions');
    for (const inst of instructions) {
      if (inst.instructions.trim()) {
        parts.push('');
        parts.push(inst.instructions);
      }
    }
  }

  // Team roster — so the agent knows who else is on the team
  if (teamRoster && teamRoster.length > 0) {
    const others = teamRoster.filter((a) => a.id !== agent.id);
    if (others.length > 0) {
      parts.push('');
      parts.push('## Your Team');
      parts.push(
        'These are the other members of your organization. You can suggest the user talk to them when appropriate:'
      );
      for (const a of others) {
        const reportsInfo = a.reportsTo ? ` (reports to ${a.reportsTo})` : '';
        parts.push(`- ${a.name} — ${a.role}${reportsInfo}`);
      }
    }
  }

  if (agent.role === 'hr-director') {
    parts.push('');
    parts.push('## Hiring Protocol');
    parts.push('When you decide to hire a new person, include exactly one machine-readable line:');
    parts.push('HIRE: Full Name | role-kebab-case');
    parts.push('Example: HIRE: Alex Morgan | backend-engineer');
  }

  parts.push('');
  parts.push('## Tool Usage');
  parts.push(
    'You have tools available. Use them aggressively — do not guess or rely on memory when a tool can give you the answer.'
  );
  parts.push('Rules:');
  parts.push(
    '- When a task requires inspecting files, code, or the workspace, call the relevant tool immediately. Do not describe what you would do — do it.'
  );
  parts.push(
    '- When you need information that a tool can retrieve (file contents, directory listing, symbol search, etc.), call the tool before responding.'
  );
  parts.push(
    '- Prefer tool evidence over recalled knowledge. If you are unsure whether something is current, call a tool to verify.'
  );
  parts.push(
    '- Chain tool calls when needed: run multiple tools in sequence to gather the full picture before composing your answer.'
  );
  parts.push(
    '- Only fall back to answering from memory when no tool can provide the needed evidence.'
  );

  parts.push('');
  parts.push('## CLI Commands Available To The User');
  parts.push('The developer can run these in-chat commands:');
  parts.push('- chat <name|role>');
  parts.push('- list');
  parts.push('- hire');
  parts.push('- history [count]');
  parts.push('- portfolio (or bio)');
  parts.push('- graph');
  parts.push('- overview');
  parts.push('- run <command> (shell command; output is shared with you)');
  parts.push('- help');
  parts.push('- exit');
  parts.push(
    'Top-level CLI commands include: ait info <agent>, ait fire <agent>, ait init, ait list, ait chat.'
  );
  parts.push(
    'When the developer shares tool output (overview snapshots, run <command>, etc.), treat it as fresh context and reference it in your reasoning.'
  );
  parts.push(
    'Treat tool output as direct evidence with provenance. Distinguish verified tool evidence from your inference.'
  );
  parts.push(
    'If tool outputs conflict, explicitly acknowledge the conflict and prioritize the strongest directly available evidence.'
  );
  parts.push(
    'If one tool call fails but other tool evidence is usable, say which call failed and proceed using the verified evidence.'
  );
  parts.push('Prefer fresh tool evidence over memory for factual claims.');
  parts.push(
    'If a person is not found, tell the user to run `chat <name>` so fuzzy search can resolve the employee.'
  );
  parts.push(
    'To hand off with a message, include exactly one line: HANDOFF: <name-or-role> | <message for that teammate>.'
  );
  parts.push(
    'Example: HANDOFF: hr-director | Please hire a chief architect and start requirement engineering staffing.'
  );

  // Behavioural guardrails
  parts.push('');
  parts.push('Stay in character. Respond as this team member would.');
  parts.push('Be concise and helpful. Use your expertise to assist the developer.');
  parts.push(
    'Be curious and proactive: ask concise clarifying questions when requirements, constraints, or success criteria are ambiguous.'
  );
  parts.push(
    'Stop asking questions once you have enough information to act; do not ask repetitive or low-value questions.'
  );
  parts.push(
    'Ask at most one high-impact clarification at a time unless the developer explicitly requests a questionnaire.'
  );
  parts.push(
    'When the user asks to be forwarded or connected to another team member, acknowledge the handoff gracefully.'
  );
  parts.push('Only hand off to people listed in "Your Team". Do not invent names or roles.');
  parts.push('Do not claim someone was hired unless they already exist in "Your Team".');
  parts.push(
    'If a requested person is not in "Your Team", tell the user to run the `hire` command first.'
  );

  return parts.join('\n');
}

// ============================================================================
// Low-level client factory (still exported for direct use)
// ============================================================================

interface LlmProviderAdapter {
  kind: string;
  createClient(config: LlmConfig, apiKey?: string): OpenAI;
  getDefaultModel(config: LlmConfig): string;
}

export type { ResolvedLlmSettings } from '@ai-team/core';

const llmProviderAdapters = new Map<string, LlmProviderAdapter>();

function registerBuiltInAdapters(): void {
  if (llmProviderAdapters.size > 0) {
    return;
  }

  llmProviderAdapters.set('github-copilot', {
    kind: 'github-copilot',
    createClient: () => {
      const token = getGitHubToken();
      return new OpenAI({
        baseURL: GITHUB_COPILOT_API_URL,
        apiKey: token,
        defaultHeaders: {
          'editor-version': 'vscode/1.96.0',
          'copilot-integration-id': 'vscode-chat',
        },
      });
    },
    getDefaultModel: (config) => config.model || DEFAULT_COPILOT_MODEL,
  });

  llmProviderAdapters.set('openai-compatible', {
    kind: 'openai-compatible',
    createClient: (config, apiKey) => {
      if (!config.baseUrl) {
        throw new Error('OpenAI-compatible provider requires a baseUrl in config');
      }

      return new OpenAI({
        baseURL: config.baseUrl,
        apiKey: apiKey || 'not-needed',
      });
    },
    getDefaultModel: (config) => config.model || 'gpt-4o',
  });
}

registerBuiltInAdapters();

export function registerLlmProviderAdapter(adapter: LlmProviderAdapter): void {
  llmProviderAdapters.set(adapter.kind, adapter);
}

export interface ApiKeyResolutionResult {
  preferredEnvVar: string;
  lookupOrder: string[];
  selectedEnvVar?: string;
  apiKey?: string;
  foundPreferred: boolean;
}

export function buildApiKeyResolutionDiagnostics(
  apiKeyResolution: ApiKeyResolutionResult,
  config: Pick<LlmConfig, 'provider' | 'baseUrl'>,
  providerRef?: string
): LlmDiagnosticMessage[] {
  const diagnostics: LlmDiagnosticMessage[] = [];

  if (!apiKeyResolution.foundPreferred && apiKeyResolution.selectedEnvVar) {
    diagnostics.push({
      level: 'warn',
      message:
        `[LLM] Preferred API key env var '${apiKeyResolution.preferredEnvVar}' was not found. ` +
        `Using fallback '${apiKeyResolution.selectedEnvVar}'. ` +
        `Looked in order: ${apiKeyResolution.lookupOrder.join(', ')}`,
    });
  }

  if (
    config.provider === 'openai-compatible' &&
    shouldWarnWhenApiKeyMissing(config.baseUrl) &&
    !apiKeyResolution.selectedEnvVar
  ) {
    diagnostics.push({
      level: 'warn',
      message:
        `[LLM] API key not found for provider '${providerRef ?? config.provider}'. ` +
        `Looked in order: ${apiKeyResolution.lookupOrder.join(', ')}`,
    });
  }

  return diagnostics;
}

export function resolveApiKeyFromEnv(
  env: Record<string, string>,
  preferredEnvVar?: string
): ApiKeyResolutionResult {
  const normalizedPreferred = preferredEnvVar?.trim() || 'AI_TEAM_LLM_API_KEY';
  const lookupOrder = Array.from(
    new Set([normalizedPreferred, 'AI_TEAM_LLM_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'])
  );

  const selectedEnvVar = lookupOrder.find((envVar) => {
    const value = env[envVar];
    return typeof value === 'string' && value.length > 0;
  });

  return {
    preferredEnvVar: normalizedPreferred,
    lookupOrder,
    selectedEnvVar,
    apiKey: selectedEnvVar ? env[selectedEnvVar] : undefined,
    foundPreferred: Boolean(env[normalizedPreferred]),
  };
}

function shouldWarnWhenApiKeyMissing(baseUrl?: string): boolean {
  if (!baseUrl) {
    return true;
  }

  try {
    const hostname = new URL(baseUrl).hostname.toLowerCase();
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1';
  } catch {
    return true;
  }
}

export { getEffectiveContextWindow } from '@ai-team/core';

export { resolveEffectiveLlmSettings, resolveSystemLlmSettings } from '@ai-team/core';

/**
 * Create an OpenAI-compatible client from LLM config
 * @param config - LLM configuration (from config.json)
 * @param apiKey - Optional API key (from .env, for openai-compatible provider)
 * @returns Configured OpenAI client
 */
export function createLlmClient(config: LlmConfig, apiKey?: string): OpenAI {
  const adapter = llmProviderAdapters.get(config.provider);
  if (!adapter) {
    throw new Error(`No provider adapter registered for: ${config.provider}`);
  }

  return adapter.createClient(config, apiKey);
}

/**
 * Get the default model name for a provider
 */
export function getDefaultModel(config: LlmConfig): string {
  const adapter = llmProviderAdapters.get(config.provider);
  if (!adapter) {
    throw new Error(`No provider adapter registered for: ${config.provider}`);
  }

  return adapter.getDefaultModel(config);
}

/**
 * Test the LLM connection by sending a simple ping message
 * @param config - LLM configuration
 * @param apiKey - Optional API key (from .env)
 * @returns The model's response text
 * @throws If the connection fails
 */
export async function testLlmConnection(config: LlmConfig, apiKey?: string): Promise<string> {
  const client = createLlmClient(config, apiKey);
  const model = getDefaultModel(config);

  const response = await withTimeout(
    createChatCompletion(client, config, {
      model,
      messages: [
        { role: 'user', content: 'Reply with exactly: "Connection successful!" and nothing else.' },
      ],
      max_tokens: 20,
    }),
    TEST_CONNECTION_TIMEOUT_MS,
    `LLM connection test timed out after ${TEST_CONNECTION_TIMEOUT_MS / 1000}s. Check network, provider URL, and credentials.`
  );

  const text = extractChatCompletionText(response);
  if (text) {
    return text;
  }

  if (hasNonTextCompletionSignal(response)) {
    return 'Connection successful (non-text completion)';
  }

  throw new Error('LLM returned an empty response');
}

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
    messages: ChatCompletionMessageParam[];
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

function safeJsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

export function buildRuntimeToolEvidence(
  toolResult: Pick<LlmToolResult, 'toolName' | 'result' | 'isError'>,
  args: Record<string, unknown>
): RuntimeToolEvidence {
  if (toolResult.isError) {
    return {
      toolName: toolResult.toolName,
      args,
      status: 'failed',
      error: stringifyToolPayload(toolResult.result),
      sourceType: 'tool',
      confidence: 'direct',
    };
  }

  return {
    toolName: toolResult.toolName,
    args,
    status: 'success',
    content: stringifyToolPayload(toolResult.result),
    sourceType: 'tool',
    confidence: 'direct',
  };
}

export function shouldUseResponsesApiForToolLoop(config: LlmConfig, model?: string): boolean {
  if (config.provider !== 'openai-compatible' || !config.baseUrl || !model) {
    return false;
  }

  let hostname: string;
  try {
    hostname = new URL(config.baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (hostname !== 'api.openai.com') {
    return false;
  }

  return model.toLowerCase().startsWith('gpt-5');
}

export function getChatRequestTimeoutMs(config: LlmConfig, model?: string): number {
  if (!model || config.provider !== 'openai-compatible' || !config.baseUrl) {
    return DEFAULT_CHAT_REQUEST_TIMEOUT_MS;
  }

  let hostname: string;
  try {
    hostname = new URL(config.baseUrl).hostname.toLowerCase();
  } catch {
    return DEFAULT_CHAT_REQUEST_TIMEOUT_MS;
  }

  if (hostname === 'api.openai.com' && model.toLowerCase().startsWith('gpt-5')) {
    return OPENAI_GPT5_CHAT_REQUEST_TIMEOUT_MS;
  }

  return DEFAULT_CHAT_REQUEST_TIMEOUT_MS;
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

export function resolveResponsesContentTypeForRole(
  role: 'system' | 'user' | 'assistant'
): 'input_text' | 'output_text' {
  return role === 'assistant' ? 'output_text' : 'input_text';
}

function mapChatMessagesToResponsesInput(
  messages: ChatCompletionMessageParam[]
): ResponseInputItem[] {
  const out: ResponseInputItem[] = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'user' || message.role === 'assistant') {
      const text = extractMessageContentText(message.content);
      if (!text) {
        continue;
      }
      out.push({
        role: message.role,
        content: [{ type: resolveResponsesContentTypeForRole(message.role), text }],
      });
      continue;
    }

    if (message.role === 'tool') {
      const text = extractMessageContentText(message.content);
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

function extractResponseOutputItems(response: unknown): ResponseInputItem[] {
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
        typeof record.name === 'string' && record.name.trim().length > 0 ? record.name : undefined;
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
      const text = extractResponsesMessageText(record);
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

function extractResponsesResponseId(response: unknown): string | undefined {
  const id = (response as { id?: unknown } | undefined)?.id;
  if (typeof id === 'string' && id.trim().length > 0) {
    return id;
  }
  return undefined;
}

function extractResponsesMessageText(record: Record<string, unknown>): string {
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

function extractResponsesOutputText(response: unknown): string {
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

    const text = extractResponsesMessageText(record);
    if (text) {
      parts.push(text);
    }
  }

  return parts.join('\n').trim();
}

function extractResponseFunctionCalls(
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

    calls.push({
      callId,
      toolName,
      rawArgs,
    });
  }

  return calls;
}

function parseToolCallArguments(rawArgs: string): unknown {
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

function stringifyToolPayload(payload: unknown): string {
  if (typeof payload === 'string') {
    return payload;
  }
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function isResponsesApiFallbackError(error: unknown): boolean {
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

export function parseBracketToolCalls(
  assistantText: string,
  knownToolNames: Set<string>
): LlmToolCall[] {
  const calls: LlmToolCall[] = [];
  const re = /\[tool:([a-zA-Z0-9_]+)\]\s*([\s\S]*?)(?=\n\s*\[tool:[a-zA-Z0-9_]+\]|$)/g;

  for (const match of assistantText.matchAll(re)) {
    const toolName = (match[1] ?? '').trim();
    if (!toolName || !knownToolNames.has(toolName)) {
      continue;
    }

    const rawPayload = (match[2] ?? '').trim();
    const normalizedPayload = rawPayload
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let args: unknown = {};
    if (normalizedPayload) {
      try {
        args = JSON.parse(normalizedPayload);
      } catch {
        continue;
      }
    }

    calls.push({
      toolCallId: randomUUID(),
      toolName,
      args,
    });
  }

  return calls;
}

export function parseTextToolCalls(
  assistantText: string,
  knownToolNames: Set<string>
): LlmToolCall[] {
  const bracketCalls = parseBracketToolCalls(assistantText, knownToolNames);
  if (bracketCalls.length > 0) {
    return bracketCalls;
  }

  const jsonFallback = parseJsonObjectToolCall(assistantText, knownToolNames);
  return jsonFallback ? [jsonFallback] : [];
}

function parseJsonObjectToolCall(
  assistantText: string,
  knownToolNames: Set<string>
): LlmToolCall | undefined {
  const normalized = assistantText.trim();
  if (!normalized) {
    return undefined;
  }

  const candidates = [normalized];
  const fenced = normalized.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed === undefined) {
      continue;
    }

    const call = jsonValueToToolCall(parsed, knownToolNames);
    if (call) {
      return call;
    }
  }

  return undefined;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function jsonValueToToolCall(
  payload: unknown,
  knownToolNames: Set<string>
): LlmToolCall | undefined {
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const nested = jsonValueToToolCall(item, knownToolNames);
      if (nested) {
        return nested;
      }
    }
    return undefined;
  }

  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const functionRecord =
    record.function && typeof record.function === 'object'
      ? (record.function as Record<string, unknown>)
      : undefined;

  const toolNameCandidate =
    readString(record.name) ||
    readString(record.toolName) ||
    readString(record.tool) ||
    readString(functionRecord?.name);

  if (!toolNameCandidate || !knownToolNames.has(toolNameCandidate)) {
    return undefined;
  }

  const rawArgs =
    record.arguments ??
    record.args ??
    record.parameters ??
    functionRecord?.arguments ??
    functionRecord?.args ??
    functionRecord?.parameters ??
    {};

  const args = normalizeToolArgs(rawArgs);

  return {
    toolCallId: randomUUID(),
    toolName: toolNameCandidate,
    args,
  };
}

function normalizeToolArgs(rawArgs: unknown): Record<string, unknown> {
  let parsed = rawArgs;

  if (typeof parsed === 'string') {
    const parsedJson = tryParseJson(parsed.trim());
    parsed = parsedJson === undefined ? {} : parsedJson;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function serializeError(error: unknown): SerializedError {
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

function extractDeltaText(delta: unknown): string {
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

type ChatCompletionRequestPayload = Record<string, unknown>;

export function hasReasoningOnlyCompletion(response: unknown): boolean {
  const choices = (response as { choices?: unknown[] } | undefined)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return false;
  }

  return choices.some((choice) => {
    const message = (
      choice as {
        message?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown };
      }
    )?.message;

    const messageText = extractMessageContentText(message?.content);
    if (messageText) {
      return false;
    }

    const directText = (choice as { text?: unknown } | undefined)?.text;
    if (typeof directText === 'string' && directText.trim().length > 0) {
      return false;
    }

    const reasoningText =
      extractMessageContentText(message?.reasoning) ||
      extractMessageContentText(message?.reasoning_content);

    return reasoningText.length > 0;
  });
}

export function buildDisableThinkingFallbackRequest(
  config: LlmConfig,
  request: ChatCompletionRequestPayload,
  response: unknown
): ChatCompletionRequestPayload | undefined {
  if (config.provider !== 'openai-compatible') {
    return undefined;
  }

  if (!hasReasoningOnlyCompletion(response)) {
    return undefined;
  }

  const existing = toRecord(request.chat_template_kwargs);
  if (existing.enable_thinking === false) {
    return undefined;
  }

  return {
    ...request,
    chat_template_kwargs: {
      ...existing,
      enable_thinking: false,
    },
  };
}

export function normalizeMessagesForProvider(
  request: ChatCompletionRequestPayload,
  config: LlmConfig
): ChatCompletionRequestPayload {
  if (config.provider !== 'openai-compatible') {
    return request;
  }

  const messages = request.messages;
  if (!Array.isArray(messages) || messages.length < 2) {
    return request;
  }

  const normalizedMessages = [...messages] as ChatCompletionMessageParam[];
  const leadingSystemMessages: ChatCompletionMessageParam[] = [];

  while (normalizedMessages[leadingSystemMessages.length]?.role === 'system') {
    leadingSystemMessages.push(normalizedMessages[leadingSystemMessages.length]);
  }

  if (leadingSystemMessages.length < 2) {
    return request;
  }

  const mergedContent = leadingSystemMessages
    .map((message) => extractMessageContentText(message.content))
    .filter((content) => content.length > 0)
    .join('\n\n');

  if (!mergedContent) {
    return request;
  }

  return {
    ...request,
    messages: [
      {
        role: 'system',
        content: mergedContent,
      },
      ...normalizedMessages.slice(leadingSystemMessages.length),
    ],
  };
}

async function createChatCompletion(
  client: OpenAI,
  config: LlmConfig,
  request: ChatCompletionRequestPayload
): Promise<any> {
  let currentRequest = normalizeMessagesForProvider(
    normalizeTokenParameter(request, config),
    config
  );
  const attempted = new Set<string>([stableRequestKey(currentRequest)]);
  let lastError: unknown;

  for (let i = 0; i < 5; i += 1) {
    try {
      return await client.chat.completions.create(currentRequest as never);
    } catch (error) {
      lastError = error;

      const fallbackCandidates = buildFallbackRequests(currentRequest, error);
      const nextRequest = fallbackCandidates.find((candidate) => {
        const key = stableRequestKey(candidate);
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

async function tryRecoverCompletionWithThinkingDisabled(
  client: OpenAI,
  config: LlmConfig,
  request: ChatCompletionRequestPayload,
  response: unknown,
  requestTimeoutMs: number,
  timeoutMessage: string
): Promise<{ response: unknown; text: string } | undefined> {
  const retryRequest = buildDisableThinkingFallbackRequest(config, request, response);
  if (!retryRequest) {
    return undefined;
  }

  try {
    const retryResponse = await withTimeout(
      createChatCompletion(client, config, retryRequest),
      requestTimeoutMs,
      timeoutMessage
    );

    const retryText = extractChatCompletionText(retryResponse);
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

function buildFallbackRequests(
  request: ChatCompletionRequestPayload,
  error: unknown
): ChatCompletionRequestPayload[] {
  const fallbacks: ChatCompletionRequestPayload[] = [];

  const maxTokenFallback = buildMaxTokensFallbackRequest(request, error);
  if (maxTokenFallback) {
    fallbacks.push(maxTokenFallback);
  }

  const samplingFallbacks = buildSamplingFallbackRequests(request, error);
  fallbacks.push(...samplingFallbacks);

  return fallbacks;
}

function buildMaxTokensFallbackRequest(
  request: ChatCompletionRequestPayload,
  error: unknown
): ChatCompletionRequestPayload | undefined {
  if (!isUnsupportedMaxTokensError(error)) {
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

function buildSamplingFallbackRequests(
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

  if (hasTemperature || hasTopP) {
    const withoutSampling: ChatCompletionRequestPayload = { ...request };
    delete withoutSampling.temperature;
    delete withoutSampling.top_p;
    candidates.push(withoutSampling);
  }

  return candidates;
}

function stableRequestKey(request: ChatCompletionRequestPayload): string {
  const sortedEntries = Object.entries(request).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(sortedEntries));
}

function normalizeTokenParameter(
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
  if (!shouldUseMaxCompletionTokens(config, model)) {
    return request;
  }

  const normalized: ChatCompletionRequestPayload = {
    ...request,
    max_completion_tokens: maxTokens,
  };
  delete normalized.max_tokens;
  return normalized;
}

function shouldUseMaxCompletionTokens(config: LlmConfig, model?: string): boolean {
  if (config.provider !== 'openai-compatible' || !config.baseUrl) {
    return false;
  }

  let hostname: string;
  try {
    hostname = new URL(config.baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  if (hostname !== 'api.openai.com') {
    return false;
  }

  if (!model) {
    return false;
  }

  return model.toLowerCase().startsWith('gpt-5');
}

function isUnsupportedMaxTokensError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('unsupported parameter') && normalized.includes('max_tokens');
}

function extractChatCompletionText(response: unknown): string {
  const choices = (response as { choices?: unknown[] } | undefined)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }

  for (const choice of choices) {
    const message = (choice as { message?: { content?: unknown } } | undefined)?.message;
    const messageText = extractMessageContentText(message?.content);
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

function extractMessageContentText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (content && typeof content === 'object') {
    const contentObject = content as {
      text?: unknown;
      value?: unknown;
      content?: unknown;
    };

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

const TITLE_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'could',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'it',
  'let',
  'lets',
  'my',
  'of',
  'on',
  'or',
  'please',
  'say',
  'should',
  'that',
  'the',
  'this',
  'to',
  'want',
  'we',
  'what',
  'when',
  'where',
  'why',
  'would',
  'with',
  'you',
  'future',
]);

const TITLE_ACTION_VERB_MAP: Record<string, string> = {
  fix: 'Fix',
  improve: 'Improve',
  add: 'Add',
  update: 'Update',
  refactor: 'Refactor',
  debug: 'Debug',
  implement: 'Implement',
  test: 'Test',
  create: 'Create',
  plan: 'Plan',
  retire: 'Retire',
  retiring: 'Retire',
  retirement: 'Plan',
  archive: 'Archive',
  offboard: 'Offboard',
  offboarding: 'Offboard',
  decommission: 'Decommission',
  sunset: 'Sunset',
  consolidate: 'Consolidate',
};

const TITLE_ACTION_WORDS = new Set(Object.keys(TITLE_ACTION_VERB_MAP));

export function deriveFallbackTitle(messages: ChatMessage[]): string {
  const source = messages
    .filter((m) => m.isHuman)
    .slice(0, 2)
    .map((m) => m.content ?? '')
    .join(' ')
    .toLowerCase();

  const words = source
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3);

  if (words.length === 0) return 'Plan Request';

  const actionWord = words.find((w) => TITLE_ACTION_VERB_MAP[w]);
  const action = actionWord ? TITLE_ACTION_VERB_MAP[actionWord] : 'Plan';

  const hasAgentToken = words.some((w) => w === 'agent' || w === 'agents');
  const hasRetirementToken = words.some((w) =>
    [
      'retire',
      'retiring',
      'retirement',
      'offboard',
      'offboarding',
      'decommission',
      'sunset',
    ].includes(w)
  );

  if (hasAgentToken && hasRetirementToken) {
    return 'Plan Agent Retirement';
  }

  const orderedUnique: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    if (TITLE_STOPWORDS.has(word) || TITLE_ACTION_WORDS.has(word)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    orderedUnique.push(word);
    if (orderedUnique.length >= 3) break;
  }

  if (orderedUnique.length === 0) return `${action} Request`;

  const top = orderedUnique.map((w) => w.charAt(0).toUpperCase() + w.slice(1));

  return `${action} ${top.join(' ')}`.trim() || `${action} Request`;
}

export function isWeakGeneratedTitle(title: string): boolean {
  const normalized = title
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim();

  if (!normalized) return true;

  const weakTitles = new Set([
    'new conversation',
    'conversation',
    'general request',
    'task request',
    'title request',
    'help request',
  ]);

  if (weakTitles.has(normalized)) return true;

  const words = normalized.split(' ').filter(Boolean);
  const wordCount = words.length;
  if (wordCount < 2) return true;

  if (words[0] === 'let' || words[0] === 'lets') return true;

  // Reject low-signal, filler-heavy titles that still satisfy 2+ words.
  const noisyWords = new Set([
    'let',
    'lets',
    'future',
    'want',
    'thing',
    'things',
    'stuff',
    'something',
    'anything',
  ]);
  const contentWords = words.filter((w) => !TITLE_STOPWORDS.has(w) && !TITLE_ACTION_WORDS.has(w));
  if (contentWords.length === 0) return true;
  if (contentWords.every((w) => noisyWords.has(w))) return true;
  if (normalized === 'let plan future want') return true;

  return false;
}

function hasNonTextCompletionSignal(response: unknown): boolean {
  const choices = (response as { choices?: unknown[] } | undefined)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return false;
  }

  return choices.some((choice) => {
    const message = (
      choice as
        | {
            message?: {
              reasoning?: unknown;
              reasoning_content?: unknown;
              tool_calls?: unknown;
              function_call?: unknown;
            };
            finish_reason?: unknown;
          }
        | undefined
    )?.message;

    const reasoning =
      extractMessageContentText(message?.reasoning) ||
      extractMessageContentText(message?.reasoning_content);
    if (reasoning.length > 0) {
      return true;
    }

    if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) {
      return true;
    }

    if (message?.function_call) {
      return true;
    }

    const finishReason = (choice as { finish_reason?: unknown } | undefined)?.finish_reason;
    return typeof finishReason === 'string' && finishReason.trim().length > 0;
  });
}

// ============================================================================
// Model discovery
// ============================================================================

/** Shape returned from the Copilot models API */
interface CopilotModel {
  id: string;
  name: string;
  capabilities: {
    family: string;
    type: string;
    limits?: {
      max_context_window_tokens?: number;
      max_prompt_tokens?: number;
      max_output_tokens?: number;
    };
  };
}

interface OpenAiCompatibleModel {
  id: string;
  object?: string;
  context_window?: number;
  input_token_limit?: number;
  output_token_limit?: number;
  max_context_window_tokens?: number;
  max_prompt_tokens?: number;
  max_output_tokens?: number;
  capabilities?: {
    limits?: {
      max_context_window_tokens?: number;
      max_prompt_tokens?: number;
      max_output_tokens?: number;
    };
  };
  context_length?: number;
  max_input_tokens?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  token_limits?: {
    context_window?: number;
    max_context_window_tokens?: number;
    max_prompt_tokens?: number;
    max_output_tokens?: number;
    max_input_tokens?: number;
    max_completion_tokens?: number;
  };
}

export interface DiscoveredProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
}

/**
 * Fetch available chat models from the GitHub Copilot API.
 *
 * Uses `GET https://api.individual.githubcopilot.com/models` which returns
 * the same models shown in the VS Code Copilot model picker.
 *
 * @returns Array of `{ id, name }` sorted by name.
 *          Returns an empty array on any network / auth error so callers can
 *          fall back to a hardcoded list.
 */
export async function fetchGitHubModels(): Promise<
  {
    id: string;
    name: string;
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  }[]
> {
  try {
    const token = getGitHubToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_FETCH_TIMEOUT_MS);
    const res = await fetch(GITHUB_COPILOT_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return COPILOT_MODEL_FALLBACK;

    const body = (await res.json()) as { data: CopilotModel[] };
    const models = body.data || [];

    // Keep chat models and preserve variants so UI can expose the full picker.
    const unique = new Map<
      string,
      {
        id: string;
        name: string;
        contextWindow?: number;
        maxPromptTokens?: number;
        maxContextWindowTokens?: number;
        maxOutputTokens?: number;
      }
    >();
    for (const m of models) {
      if (m.capabilities?.type !== 'chat') continue;
      // Skip internal/auto models
      if (m.capabilities.family.startsWith('goldeneye')) continue;

      const maxPromptTokens = m.capabilities?.limits?.max_prompt_tokens;
      const maxContextWindowTokens = m.capabilities?.limits?.max_context_window_tokens;
      const maxOutputTokens = m.capabilities?.limits?.max_output_tokens;
      const contextWindow = maxPromptTokens ?? maxContextWindowTokens;

      if (!unique.has(m.id)) {
        unique.set(m.id, {
          id: m.id,
          name: m.name,
          contextWindow,
          maxPromptTokens,
          maxContextWindowTokens,
          maxOutputTokens,
        });
      }
    }

    const resolved = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));

    return resolved.length > 0 ? resolved : COPILOT_MODEL_FALLBACK;
  } catch {
    return COPILOT_MODEL_FALLBACK;
  }
}

/**
 * Fetch available models from an OpenAI-compatible endpoint.
 *
 * Calls `GET {baseUrl}/models` and returns model IDs.
 * Handles both with/without API key endpoints.
 */
export async function fetchOpenAICompatibleModels(
  baseUrl: string,
  apiKey?: string
): Promise<string[]> {
  const detailed = await fetchOpenAICompatibleModelsDetailed(baseUrl, apiKey);
  return detailed.map((m) => m.id);
}

/**
 * Fetch available models and best-effort limit metadata from an OpenAI-compatible endpoint.
 *
 * This function primarily calls `GET {baseUrl}/models`. Some providers include
 * token limits in list responses; for providers that don't, it optionally tries
 * `GET {baseUrl}/models/{id}` for a subset of chat-oriented models.
 */
export async function fetchOpenAICompatibleModelsDetailed(
  baseUrl: string,
  apiKey?: string
): Promise<DiscoveredProviderModel[]> {
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;

  const stripped = normalized
    .replace(/\/?chat\/completions$/i, '')
    .replace(/\/?responses$/i, '')
    .replace(/\/?completions$/i, '');

  const endpointCandidates = getOpenAiModelsEndpointCandidates(stripped);

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const tryExtractModel = (model: OpenAiCompatibleModel): DiscoveredProviderModel | undefined => {
    if (typeof model.id !== 'string' || model.id.trim().length === 0) {
      return undefined;
    }

    const id = model.id.trim();
    const extracted = extractOpenAiLimitMetadata(model);

    return {
      id,
      name: id,
      contextWindow: extracted.contextWindow,
      maxPromptTokens: extracted.maxPromptTokens,
      maxContextWindowTokens: extracted.maxContextWindowTokens,
      maxOutputTokens: extracted.maxOutputTokens,
    };
  };

  for (const url of endpointCandidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL_FETCH_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      if (!res.ok) {
        continue;
      }

      const body = (await res.json()) as { data?: OpenAiCompatibleModel[] };
      const listed = (body.data || [])
        .map((model) => tryExtractModel(model))
        .filter((model): model is DiscoveredProviderModel => Boolean(model));

      if (listed.length > 0) {
        const enriched = await enrichOpenAiModelLimits(url, listed, headers);
        return [...enriched].sort((a, b) => a.name.localeCompare(b.name));
      }
    } catch {
      // try next candidate endpoint
    } finally {
      clearTimeout(timer);
    }
  }

  return [];
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function getOpenAiModelsEndpointCandidates(strippedBaseUrl: string): string[] {
  const endpointCandidates: string[] = [];
  const pushCandidate = (url: string) => {
    if (!endpointCandidates.includes(url)) {
      endpointCandidates.push(url);
    }
  };

  pushCandidate(`${strippedBaseUrl}/models`);

  try {
    const parsed = new URL(strippedBaseUrl);
    pushCandidate(`${parsed.origin}/v1/models`);
    pushCandidate(`${parsed.origin}/models`);
  } catch {
    // ignore invalid URL parsing here; fetch attempts below will fail safely
  }

  return endpointCandidates;
}

async function enrichOpenAiModelLimits(
  listEndpoint: string,
  listedModels: DiscoveredProviderModel[],
  headers: Record<string, string>
): Promise<DiscoveredProviderModel[]> {
  const withLimits = listedModels.filter(
    (m) => m.maxPromptTokens || m.maxContextWindowTokens || m.maxOutputTokens
  );
  if (withLimits.length > 0) {
    return listedModels;
  }

  const detailCandidates = listedModels
    .filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id))
    .slice(0, 30);

  if (detailCandidates.length === 0) {
    return listedModels;
  }

  const base = listEndpoint.endsWith('/models')
    ? listEndpoint
    : `${listEndpoint.replace(/\/$/, '')}/models`;
  const out = new Map(listedModels.map((m) => [m.id, { ...m }]));

  await Promise.all(
    detailCandidates.map(async (model) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(MODEL_FETCH_TIMEOUT_MS, 5_000));
      try {
        const response = await fetch(`${base}/${encodeURIComponent(model.id)}`, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }

        const details = (await response.json()) as OpenAiCompatibleModel;
        const extracted = extractOpenAiLimitMetadata(details);
        const maxPromptTokens = extracted.maxPromptTokens;
        const maxContextWindowTokens = extracted.maxContextWindowTokens;
        const maxOutputTokens = extracted.maxOutputTokens;

        if (!maxPromptTokens && !maxContextWindowTokens && !maxOutputTokens) {
          return;
        }

        out.set(model.id, {
          ...model,
          contextWindow: extracted.contextWindow ?? model.contextWindow,
          maxPromptTokens: maxPromptTokens ?? model.maxPromptTokens,
          maxContextWindowTokens: maxContextWindowTokens ?? model.maxContextWindowTokens,
          maxOutputTokens: maxOutputTokens ?? model.maxOutputTokens,
        });
      } catch {
        // best-effort only
      } finally {
        clearTimeout(timer);
      }
    })
  );

  return [...out.values()];
}

function extractOpenAiLimitMetadata(model: OpenAiCompatibleModel): {
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
} {
  const modelRecord = model as unknown as Record<string, unknown>;
  const tokenLimits = modelRecord.token_limits as Record<string, unknown> | undefined;
  const capabilities = modelRecord.capabilities as Record<string, unknown> | undefined;
  const capabilitiesLimits = capabilities?.limits as Record<string, unknown> | undefined;

  const maxPromptTokens =
    toPositiveInt(modelRecord.max_prompt_tokens) ??
    toPositiveInt(modelRecord.input_token_limit) ??
    toPositiveInt(modelRecord.max_input_tokens) ??
    toPositiveInt(tokenLimits?.max_prompt_tokens) ??
    toPositiveInt(tokenLimits?.max_input_tokens) ??
    toPositiveInt(capabilitiesLimits?.max_prompt_tokens);

  const maxContextWindowTokens =
    toPositiveInt(modelRecord.max_context_window_tokens) ??
    toPositiveInt(modelRecord.context_window) ??
    toPositiveInt(modelRecord.context_length) ??
    toPositiveInt(tokenLimits?.max_context_window_tokens) ??
    toPositiveInt(tokenLimits?.context_window) ??
    toPositiveInt(capabilitiesLimits?.max_context_window_tokens);

  const maxOutputTokens =
    toPositiveInt(modelRecord.max_output_tokens) ??
    toPositiveInt(modelRecord.output_token_limit) ??
    toPositiveInt(modelRecord.max_completion_tokens) ??
    toPositiveInt(tokenLimits?.max_output_tokens) ??
    toPositiveInt(tokenLimits?.max_completion_tokens) ??
    toPositiveInt(capabilitiesLimits?.max_output_tokens);

  return {
    contextWindow: maxPromptTokens ?? maxContextWindowTokens,
    maxPromptTokens,
    maxContextWindowTokens,
    maxOutputTokens,
  };
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Get a GitHub token from the GitHub CLI
 * @returns GitHub auth token
 * @throws If `gh` CLI is not installed or not authenticated
 */
export function getGitHubToken(): string {
  try {
    const token = execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: GITHUB_TOKEN_TIMEOUT_MS,
    }).trim();
    if (!token) {
      throw new Error('gh auth token returned empty');
    }
    return token;
  } catch (error) {
    throw new Error(
      'Could not get GitHub token. Make sure the GitHub CLI is installed and authenticated:\n' +
        '  1. Install: https://cli.github.com\n' +
        '  2. Login:   gh auth login\n' +
        (error instanceof Error ? `\nDetails: ${error.message}` : '')
    );
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
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

export { type ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
