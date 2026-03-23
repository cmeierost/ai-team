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

import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import OpenAI from 'openai';
import type { ChatCompletionChunk, ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import path from 'path';
import type { LlmConfig, Agent, Skill, InstructionFile, ChatMessage, TeamConfig, LlmGenerationParams } from '../types/index.js';
import { loadEffectiveConfig, loadEnvFile } from '../storage/index.js';

export type { ChatCompletionMessageParam };

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
  { id: 'claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', contextWindow: 128_000, maxPromptTokens: 128_000 },
  { id: 'claude-3.7-sonnet', name: 'Claude 3.7 Sonnet', contextWindow: 128_000, maxPromptTokens: 128_000 },
  { id: 'claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: 144_000, maxPromptTokens: 144_000 },
  { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', contextWindow: 160_000, maxPromptTokens: 160_000 },
  { id: 'o1', name: 'o1', contextWindow: 128_000, maxPromptTokens: 128_000 },
  { id: 'o1-mini', name: 'o1-mini', contextWindow: 128_000, maxPromptTokens: 128_000 },
  { id: 'o3-mini', name: 'o3-mini', contextWindow: 128_000, maxPromptTokens: 128_000 },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 173_000, maxPromptTokens: 173_000 },
].sort((a, b) => a.name.localeCompare(b.name));
const GITHUB_TOKEN_TIMEOUT_MS = 15_000;
const MODEL_FETCH_TIMEOUT_MS = 15_000;
const TEST_CONNECTION_TIMEOUT_MS = 20_000;
const CHAT_REQUEST_TIMEOUT_MS = 30_000;
const STREAM_CHUNK_TIMEOUT_MS = 30_000;

// ============================================================================
// LlmService — high-level abstraction for any configured provider
// ============================================================================

export interface LlmChatOptions {
  /** Override the model for this call */
  model?: string;
  /** Max tokens in the response */
  maxTokens?: number;
  /** Temperature (0-2) */
  temperature?: number;
  /** Top-p nucleus sampling (0-1) */
  topP?: number;
  /** Presence penalty (-2 to 2) */
  presencePenalty?: number;
  /** Frequency penalty (-2 to 2) */
  frequencyPenalty?: number;
  /** Stop sequences */
  stop?: string[];
  /** Whether to stream the response */
  stream?: boolean;
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
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

export interface LlmToolChatResult {
  text: string;
  toolResults: LlmToolResult[];
}

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

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.logDir = path.join(this.workspaceRoot, '.ai-team', 'logs', 'llm');
  }

  /**
   * Load workspace config + env and create the OpenAI client.
   * Must be called once before `chat()` / `streamChat()`.
   * @throws If no LLM config is found
   */
  async initialize(): Promise<void> {
    await this.initializeForChat();
  }

  async initializeForChat(
    agent?: Pick<Agent, 'llm'>,
    skill?: Pick<Skill, 'llm'>,
    runtimeOverrides?: LlmChatOptions,
  ): Promise<LlmChatOptions> {
    const teamConfig = await loadEffectiveConfig(this.workspaceRoot);
    if (!teamConfig) {
      throw new Error(
        'No LLM configuration found. Run "ait init" to configure a provider.'
      );
    }

    const resolved = resolveEffectiveLlmSettings(teamConfig, agent, skill, runtimeOverrides);
    this.config = resolved.config;
    this.providerRef = resolved.providerRef;
    this.model = getDefaultModel(this.config);

    const env = await loadEnvFile(this.workspaceRoot);
    const apiKeyName = resolved.apiKeyEnvVar || 'AI_TEAM_LLM_API_KEY';
    const apiKey = env[apiKeyName] || env['AI_TEAM_LLM_API_KEY'] || env['LLM_API_KEY'] || env['OPENAI_API_KEY'];

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
    teamRoster?: Agent[],
  ): Promise<string> {
    this.assertReady();

    const systemPrompt = buildSystemPrompt(agent, skills, teamRoster);
    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
    const start = Date.now();
    const logBase = this.buildLogBase('chat', agent, allMessages, options, skills, teamRoster);

    try {
      const response = await withTimeout(
        createChatCompletion(this.client, this.config, {
          model: options?.model ?? this.model,
          messages: allMessages,
          max_tokens: options?.maxTokens,
          temperature: options?.temperature,
          top_p: options?.topP,
          presence_penalty: options?.presencePenalty,
          frequency_penalty: options?.frequencyPenalty,
          stop: options?.stop,
        }),
        CHAT_REQUEST_TIMEOUT_MS,
        `LLM request timed out after ${CHAT_REQUEST_TIMEOUT_MS / 1000}s.`,
      );

      const text = extractChatCompletionText(response);
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
    teamRoster?: Agent[],
  ) {
    this.assertReady();

    const systemPrompt = buildSystemPrompt(agent, skills, teamRoster);
    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];
    const start = Date.now();
    const logBase = this.buildLogBase('stream', agent, allMessages, options, skills, teamRoster);

    try {
      const stream = await withTimeout(
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
        CHAT_REQUEST_TIMEOUT_MS,
        `LLM stream setup timed out after ${CHAT_REQUEST_TIMEOUT_MS / 1000}s.`,
      ) as AsyncIterable<ChatCompletionChunk>;

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
    instructions?: InstructionFile[],
  ): Promise<LlmToolChatResult> {
    this.assertReady();

    const systemPrompt = buildSystemPrompt(agent, skills, teamRoster, instructions);
    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const logBase = this.buildLogBase('chat', agent, allMessages, options, skills, teamRoster);
    const start = Date.now();
    const collectedResults: LlmToolResult[] = [];

    try {
      for (let round = 0; round < maxToolRounds; round++) {
        const stream = await withTimeout(
          createChatCompletion(this.client, this.config, {
            model: options?.model ?? this.model,
            messages: allMessages,
            max_tokens: options?.maxTokens,
            temperature: options?.temperature,
            top_p: options?.topP,
            presence_penalty: options?.presencePenalty,
            frequency_penalty: options?.frequencyPenalty,
            stop: options?.stop,
            tools: tools.map(tool => ({
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
          CHAT_REQUEST_TIMEOUT_MS,
          `LLM request timed out after ${CHAT_REQUEST_TIMEOUT_MS / 1000}s.`,
        ) as AsyncIterable<ChatCompletionChunk>;

        const toolCallMap = new Map<number, { id?: string; name: string; args: string }>();
        let assistantText = '';

        const iterator = stream[Symbol.asyncIterator]();
        while (true) {
          const nextChunk = await withTimeout(
            iterator.next(),
            STREAM_CHUNK_TIMEOUT_MS,
            `LLM tool stream timed out after ${STREAM_CHUNK_TIMEOUT_MS / 1000}s without receiving output.`,
          );

          if (nextChunk.done) {
            break;
          }

          const chunk = nextChunk.value;
          const delta = chunk.choices?.[0]?.delta;
          const deltaText = extractDeltaText(delta?.content) || extractDeltaText((delta as { reasoning_content?: unknown } | undefined)?.reasoning_content);
          if (deltaText) {
            assistantText += deltaText;
            onToken?.(deltaText);
          }

          const deltaToolCalls = (delta as { tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }> } | undefined)?.tool_calls;

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

        const toolCalls = [...toolCallMap.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, value]) => ({
            id: value.id || randomUUID(),
            type: 'function' as const,
            function: {
              name: value.name,
              arguments: value.args || '{}',
            },
          }))
          .filter(toolCall => toolCall.function.name.trim().length > 0);

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

          const payload = toolResult.isError
            ? { error: toolResult.result }
            : { result: toolResult.result };

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
  static historyToMessages(
    history: ChatMessage[],
    agentId: string,
  ): ChatCompletionMessageParam[] {
    return history.map((msg) => ({
      role: msg.from === 'human' ? 'user' as const : 'assistant' as const,
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
    options?: LlmChatOptions,
  ): Promise<string> {
    this.assertReady();

    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const start = Date.now();
    const logBase = this.buildRawLogBase('raw-chat', allMessages, options);

    try {
      const response = await withTimeout(
        createChatCompletion(this.client, this.config, {
          model: options?.model ?? this.model,
          messages: allMessages,
          max_tokens: options?.maxTokens,
          temperature: options?.temperature,
          top_p: options?.topP,
          presence_penalty: options?.presencePenalty,
          frequency_penalty: options?.frequencyPenalty,
          stop: options?.stop,
        }),
        CHAT_REQUEST_TIMEOUT_MS,
        `LLM request timed out after ${CHAT_REQUEST_TIMEOUT_MS / 1000}s.`,
      );

      const text = extractChatCompletionText(response);
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
    options?: LlmChatOptions,
  ) {
    this.assertReady();

    const allMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const start = Date.now();
    const logBase = this.buildRawLogBase('raw-stream', allMessages, options);

    try {
      const stream = await withTimeout(
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
        CHAT_REQUEST_TIMEOUT_MS,
        `LLM stream setup timed out after ${CHAT_REQUEST_TIMEOUT_MS / 1000}s.`,
      ) as AsyncIterable<ChatCompletionChunk>;

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
    teamRoster?: Agent[],
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
        skills: skills?.map(s => ({
          name: s.name,
          filePath: s.filePath,
        })),
        teamRoster: teamRoster?.map(a => ({
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
    options?: LlmChatOptions,
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
    return messages.map(msg => safeJsonClone(msg) as ChatCompletionMessageParam);
  }

  private wrapStreamWithLogging(
    stream: AsyncIterable<ChatCompletionChunk>,
    logBase: LlmLogBase,
    start: number,
    chunkTimeoutMs: number,
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
            `LLM stream timed out after ${chunkTimeoutMs / 1000}s without receiving output.`,
          );
          if (nextChunk.done) {
            break;
          }
          const chunk = nextChunk.value;
          snapshots.push(safeJsonClone(chunk));
          const delta = chunk.choices?.[0]?.delta;
          text += extractDeltaText(delta?.content) || extractDeltaText((delta as { reasoning_content?: unknown } | undefined)?.reasoning_content);
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
export function buildSystemPrompt(agent: Agent, skills?: Skill[], teamRoster?: Agent[], instructions?: InstructionFile[]): string {
  const parts: string[] = [];

  // Identity
  parts.push(`You are ${agent.name}, a virtual AI team member.`);
  parts.push(`Your role: ${agent.role}`);
  if (agent.reportsTo) {
    const manager = teamRoster?.find(a => a.id === agent.reportsTo);
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
  const skillsWithInstructions = skills?.filter(s => s.instructions) ?? [];
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
    const others = teamRoster.filter(a => a.id !== agent.id);
    if (others.length > 0) {
      parts.push('');
      parts.push('## Your Team');
      parts.push('These are the other members of your organization. You can suggest the user talk to them when appropriate:');
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
  parts.push('Top-level CLI commands include: ait info <agent>, ait fire <agent>, ait init, ait list, ait chat.');
  parts.push('When the developer shares tool output (overview snapshots, run <command>, etc.), treat it as fresh context and reference it in your reasoning.');
  parts.push('If a person is not found, tell the user to run `chat <name>` so fuzzy search can resolve the employee.');
  parts.push('To hand off with a message, include exactly one line: HANDOFF: <name-or-role> | <message for that teammate>.');
  parts.push('Example: HANDOFF: hr-director | Please hire a chief architect and start requirement engineering staffing.');

  // Behavioural guardrails
  parts.push('');
  parts.push('Stay in character. Respond as this team member would.');
  parts.push('Be concise and helpful. Use your expertise to assist the developer.');
  parts.push('Be curious and proactive: ask concise clarifying questions when requirements, constraints, or success criteria are ambiguous.');
  parts.push('Stop asking questions once you have enough information to act; do not ask repetitive or low-value questions.');
  parts.push('Ask at most one high-impact clarification at a time unless the developer explicitly requests a questionnaire.');
  parts.push('When the user asks to be forwarded or connected to another team member, acknowledge the handoff gracefully.');
  parts.push('Only hand off to people listed in "Your Team". Do not invent names or roles.');
  parts.push('Do not claim someone was hired unless they already exist in "Your Team".');
  parts.push('If a requested person is not in "Your Team", tell the user to run the `hire` command first.');

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

export interface ResolvedLlmSettings {
  config: LlmConfig;
  options: LlmChatOptions;
  providerRef?: string;
  apiKeyEnvVar?: string;
  contextWindow?: number;
}

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

function mergeLlmParams(
  base?: LlmGenerationParams,
  override?: LlmGenerationParams,
): LlmGenerationParams | undefined {
  if (!base && !override) {
    return undefined;
  }

  return {
    ...(base || {}),
    ...(override || {}),
  };
}

function profileToOptions(params?: LlmGenerationParams): LlmChatOptions {
  if (!params) {
    return {};
  }

  return {
    temperature: params.temperature,
    maxTokens: params.maxTokens,
    topP: params.topP,
    presencePenalty: params.presencePenalty,
    frequencyPenalty: params.frequencyPenalty,
    stop: params.stop,
  };
}

function getProviderModels(
  provider: {
    models?: Array<{ name: string; contextWindow?: number }>;
  } | undefined,
): Array<{ name: string; contextWindow?: number }> {
  if (!provider) return [];

  const out: Array<{ name: string; contextWindow?: number }> = [];
  const seen = new Set<string>();

  for (const model of provider.models ?? []) {
    if (!model?.name || seen.has(model.name)) continue;
    seen.add(model.name);
    out.push({ name: model.name, contextWindow: model.contextWindow });
  }

  return out;
}

function resolveProviderDefaultModel(
  provider:
    | {
      model?: string;
      defaultModel?: string;
      models?: Array<{ name: string; contextWindow?: number }>;
    }
    | undefined,
): string | undefined {
  if (!provider) return undefined;

  const byName = provider.defaultModel;
  if (byName) return byName;

  if (provider.model) return provider.model;

  return getProviderModels(provider)[0]?.name;
}

function applyProfile(
  config: LlmConfig,
  profile: { provider?: string; modelKey?: string; model?: string; baseUrl?: string; params?: LlmGenerationParams } | undefined,
  teamConfig?: TeamConfig,
): { config: LlmConfig; providerRef?: string; apiKeyEnvVar?: string } {
  if (!profile) {
    return { config };
  }

  let nextConfig: LlmConfig = { ...config };
  let providerRef: string | undefined;
  let apiKeyEnvVar: string | undefined;
  const registry = getProviderRegistry(teamConfig);

  if (profile.provider) {
    const providerFromRegistry = registry?.[profile.provider];
    if (providerFromRegistry) {
      providerRef = profile.provider;
      apiKeyEnvVar = providerFromRegistry.apiKeyEnvVar;
      nextConfig = {
        provider: providerFromRegistry.kind,
        model: resolveProviderDefaultModel(providerFromRegistry),
        baseUrl: providerFromRegistry.baseUrl,
        params: providerFromRegistry.params,
      };
    } else {
      nextConfig.provider = profile.provider;
    }
  }

  if (profile.modelKey !== undefined) {
    const modelKeyEntry = teamConfig?.modelKeys?.[profile.modelKey];
    const mappedProviderRef = modelKeyEntry?.provider;
    const mappedProvider = mappedProviderRef ? registry?.[mappedProviderRef] : undefined;
    const explicitProviderMatchesMapping = !providerRef || providerRef === mappedProviderRef;

    if (modelKeyEntry && mappedProvider && explicitProviderMatchesMapping) {
      providerRef = mappedProviderRef;
      apiKeyEnvVar = mappedProvider.apiKeyEnvVar;
      nextConfig = {
        provider: mappedProvider.kind,
        model: modelKeyEntry.model,
        baseUrl: mappedProvider.baseUrl,
        params: mappedProvider.params,
      };
    } else {
      const selectedProviderRef = providerRef || findDefaultProviderRef(teamConfig);
      const selectedProvider = selectedProviderRef ? registry?.[selectedProviderRef] : undefined;
      const resolvedModel = getProviderModels(selectedProvider).find((m) => m.name === profile.modelKey)?.name;
      if (resolvedModel) {
        nextConfig.model = resolvedModel;
      } else {
        const fallbackModel = resolveProviderDefaultModel(selectedProvider);
        if (fallbackModel) {
          nextConfig.model = fallbackModel;
        }
      }
    }
  }

  if (profile.model !== undefined) {
    nextConfig.model = profile.model;
  }

  if (profile.baseUrl !== undefined) {
    nextConfig.baseUrl = profile.baseUrl;
  }

  nextConfig.params = mergeLlmParams(nextConfig.params, profile.params);

  return { config: nextConfig, providerRef, apiKeyEnvVar };
}

function getProviderRegistry(teamConfig?: TeamConfig) {
  return teamConfig?.providers;
}

function findModelKeyForModel(
  provider: { models?: Array<{ name: string; contextWindow?: number }> } | undefined,
  modelId: string,
): string | undefined {
  if (!provider?.models) return undefined;
  return provider.models.find((m) => m.name === modelId)?.name;
}

export function getEffectiveContextWindow(
  providerConfig: {
    contextWindow?: number;
    models?: Array<{ name: string; contextWindow?: number }>;
  } | undefined,
  modelKey?: string,
): number | undefined {
  if (!providerConfig) return undefined;
  if (modelKey) {
    const arrayModelContext = providerConfig.models?.find((m) => m.name === modelKey)?.contextWindow;
    if (arrayModelContext !== undefined) return arrayModelContext;
  }
  return providerConfig.contextWindow;
}

function findDefaultProviderRef(teamConfig?: TeamConfig): string | undefined {
  const registry = getProviderRegistry(teamConfig);
  if (!registry) {
    return undefined;
  }

  const defaultFromFlag = Object.entries(registry).find(([, cfg]) => cfg.isDefault)?.[0];
  if (defaultFromFlag) {
    return defaultFromFlag;
  }

  if (teamConfig?.defaultLlmProvider && registry[teamConfig.defaultLlmProvider]) {
    return teamConfig.defaultLlmProvider;
  }

  return Object.keys(registry)[0];
}

export function resolveEffectiveLlmSettings(
  teamConfig: TeamConfig,
  agent?: Pick<Agent, 'llm'>,
  skill?: Pick<Skill, 'llm'>,
  runtimeOverrides?: LlmChatOptions,
): ResolvedLlmSettings {
  let providerRef: string | undefined;
  let apiKeyEnvVar: string | undefined;
  const registry = getProviderRegistry(teamConfig);

  let baseConfig: LlmConfig | undefined = teamConfig.llm;
  const defaultProviderRef = findDefaultProviderRef(teamConfig);
  if (defaultProviderRef && registry?.[defaultProviderRef]) {
    const providerConfig = registry[defaultProviderRef];
    providerRef = defaultProviderRef;
    apiKeyEnvVar = providerConfig.apiKeyEnvVar;
    baseConfig = {
      provider: providerConfig.kind,
      model: resolveProviderDefaultModel(providerConfig),
      baseUrl: providerConfig.baseUrl,
      params: providerConfig.params,
    };
  }

  if (!baseConfig) {
    throw new Error('No effective LLM configuration found. Set `providers` (with one `isDefault: true`) or `llm` in .ai-team/config.json');
  }

  let merged = applyProfile(baseConfig, skill?.llm, teamConfig);
  if (merged.providerRef) {
    providerRef = merged.providerRef;
  }
  if (merged.apiKeyEnvVar) {
    apiKeyEnvVar = merged.apiKeyEnvVar;
  }

  merged = applyProfile(merged.config, agent?.llm, teamConfig);
  if (merged.providerRef) {
    providerRef = merged.providerRef;
  }
  if (merged.apiKeyEnvVar) {
    apiKeyEnvVar = merged.apiKeyEnvVar;
  }

  const profileOptions = profileToOptions(merged.config.params);
  const options: LlmChatOptions = {
    ...profileOptions,
    ...(runtimeOverrides || {}),
  };

  const finalProvider = providerRef ? registry?.[providerRef] : undefined;
  const effectiveModelKey = findModelKeyForModel(finalProvider, merged.config.model || '');
  const contextWindow = getEffectiveContextWindow(finalProvider, effectiveModelKey);

  return {
    config: merged.config,
    options,
    providerRef,
    apiKeyEnvVar,
    contextWindow,
  };
}

export function resolveSystemLlmSettings(
  teamConfig: TeamConfig,
  purposeKey: string,
): ResolvedLlmSettings {
  const profile = teamConfig.systemModels?.[purposeKey];
  const agent = profile
    ? { llm: { provider: profile.provider, modelKey: profile.modelKey } }
    : undefined;
  return resolveEffectiveLlmSettings(teamConfig, agent as any);
}

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
    `LLM connection test timed out after ${TEST_CONNECTION_TIMEOUT_MS / 1000}s. Check network, provider URL, and credentials.`,
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

interface LlmLogPayload extends LlmLogBase {
  durationMs?: number;
  response?: {
    text?: string;
    raw?: unknown;
  };
  error?: SerializedError;
}

interface SerializedError {
  name?: string;
  message: string;
  stack?: string;
}

function safeJsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
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
    return delta.map(part => {
      if (typeof part === 'string') return part;
      if (typeof part === 'object' && part && 'text' in part && typeof (part as { text?: string }).text === 'string') {
        return (part as { text?: string }).text ?? '';
      }
      return '';
    }).join('');
  }
  return '';
}

type ChatCompletionRequestPayload = Record<string, unknown>;

async function createChatCompletion(
  client: OpenAI,
  config: LlmConfig,
  request: ChatCompletionRequestPayload,
): Promise<any> {
  let currentRequest = normalizeTokenParameter(request, config);
  const attempted = new Set<string>([stableRequestKey(currentRequest)]);
  let lastError: unknown;

  for (let i = 0; i < 5; i += 1) {
    try {
      return await client.chat.completions.create(currentRequest as never);
    } catch (error) {
      lastError = error;

      const fallbackCandidates = buildFallbackRequests(currentRequest, error);
      const nextRequest = fallbackCandidates.find(candidate => {
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

function buildFallbackRequests(
  request: ChatCompletionRequestPayload,
  error: unknown,
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
  error: unknown,
): ChatCompletionRequestPayload | undefined {
  if (!isUnsupportedMaxTokensError(error)) {
    return undefined;
  }

  if (!Object.prototype.hasOwnProperty.call(request, 'max_tokens')) {
    return undefined;
  }

  const maxTokens = request.max_tokens;
  if (maxTokens === undefined || Object.prototype.hasOwnProperty.call(request, 'max_completion_tokens')) {
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
  error: unknown,
): ChatCompletionRequestPayload[] {
  const candidates: ChatCompletionRequestPayload[] = [];
  const hasTemperature = Object.prototype.hasOwnProperty.call(request, 'temperature') && request.temperature !== undefined;
  const hasTopP = Object.prototype.hasOwnProperty.call(request, 'top_p') && request.top_p !== undefined;

  if (!hasTemperature && !hasTopP) {
    return candidates;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const temperatureUnsupported = hasTemperature && (message.includes('temperature') || message.includes('sampling parameter'))
    && (message.includes('not supported') || message.includes('unsupported'));
  const topPUnsupported = hasTopP && (message.includes('top_p') || message.includes('top p') || message.includes('sampling parameter'))
    && (message.includes('not supported') || message.includes('unsupported'));

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

function normalizeTokenParameter(request: ChatCompletionRequestPayload, config: LlmConfig): ChatCompletionRequestPayload {
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

function hasNonTextCompletionSignal(response: unknown): boolean {
  const choices = (response as { choices?: unknown[] } | undefined)?.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return false;
  }

  return choices.some(choice => {
    const message = (choice as {
      message?: {
        reasoning_content?: unknown;
        tool_calls?: unknown;
        function_call?: unknown;
      };
      finish_reason?: unknown;
    } | undefined)?.message;

    const reasoning = message?.reasoning_content;
    if (typeof reasoning === 'string' && reasoning.trim().length > 0) {
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

    const body = await res.json() as { data: CopilotModel[] };
    const models = body.data || [];

    // Keep chat models and preserve variants so UI can expose the full picker.
    const unique = new Map<string, {
      id: string;
      name: string;
      contextWindow?: number;
      maxPromptTokens?: number;
      maxContextWindowTokens?: number;
      maxOutputTokens?: number;
    }>();
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

    const resolved = [...unique.values()]
      .sort((a, b) => a.name.localeCompare(b.name));

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
  apiKey?: string,
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
  apiKey?: string,
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

      const body = await res.json() as { data?: OpenAiCompatibleModel[] };
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
  headers: Record<string, string>,
): Promise<DiscoveredProviderModel[]> {
  const withLimits = listedModels.filter((m) => m.maxPromptTokens || m.maxContextWindowTokens || m.maxOutputTokens);
  if (withLimits.length > 0) {
    return listedModels;
  }

  const detailCandidates = listedModels
    .filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id))
    .slice(0, 30);

  if (detailCandidates.length === 0) {
    return listedModels;
  }

  const base = listEndpoint.endsWith('/models') ? listEndpoint : `${listEndpoint.replace(/\/$/, '')}/models`;
  const out = new Map(listedModels.map((m) => [m.id, { ...m }]));

  await Promise.all(detailCandidates.map(async (model) => {
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

      const details = await response.json() as OpenAiCompatibleModel;
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
  }));

  return [...out.values()];
}

function extractOpenAiLimitMetadata(model: OpenAiCompatibleModel): {
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
} {
  const modelRecord = model as unknown as Record<string, unknown>;
  const tokenLimits = (modelRecord.token_limits as Record<string, unknown> | undefined);
  const capabilities = (modelRecord.capabilities as Record<string, unknown> | undefined);
  const capabilitiesLimits = (capabilities?.limits as Record<string, unknown> | undefined);

  const maxPromptTokens =
    toPositiveInt(modelRecord.max_prompt_tokens)
    ?? toPositiveInt(modelRecord.input_token_limit)
    ?? toPositiveInt(modelRecord.max_input_tokens)
    ?? toPositiveInt(tokenLimits?.max_prompt_tokens)
    ?? toPositiveInt(tokenLimits?.max_input_tokens)
    ?? toPositiveInt(capabilitiesLimits?.max_prompt_tokens);

  const maxContextWindowTokens =
    toPositiveInt(modelRecord.max_context_window_tokens)
    ?? toPositiveInt(modelRecord.context_window)
    ?? toPositiveInt(modelRecord.context_length)
    ?? toPositiveInt(tokenLimits?.max_context_window_tokens)
    ?? toPositiveInt(tokenLimits?.context_window)
    ?? toPositiveInt(capabilitiesLimits?.max_context_window_tokens);

  const maxOutputTokens =
    toPositiveInt(modelRecord.max_output_tokens)
    ?? toPositiveInt(modelRecord.output_token_limit)
    ?? toPositiveInt(modelRecord.max_completion_tokens)
    ?? toPositiveInt(tokenLimits?.max_output_tokens)
    ?? toPositiveInt(tokenLimits?.max_completion_tokens)
    ?? toPositiveInt(capabilitiesLimits?.max_output_tokens);

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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
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
