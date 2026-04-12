import type {
  LlmConfig,
  Agent,
  Skill,
  InstructionFile,
  ChatMessage,
  TeamConfig,
} from '../types/index.js';

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

export interface LlmToolChatResult {
  text: string;
  toolResults: LlmToolResult[];
}

export interface OpenAIAdapter {}

export type ChatCompletionMessageParams = {};

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
export interface ILlmService {
  /**
   * Load workspace config + env and create the OpenAI client.
   * Must be called once before `chat()` / `streamChat()`.
   * @throws If no LLM config is found
   */
  initialize(): Promise<void>;

  initializeForChat(
    agent?: Pick<Agent, 'llm'>,
    skill?: Pick<Skill, 'llm'>,
    runtimeOverrides?: LlmChatOptions
  ): Promise<LlmChatOptions>;

  /** The resolved model name (e.g. "claude-sonnet-4.6") */
  get modelName(): string;

  /** The provider name (e.g. "github-copilot") */
  get provider(): string;

  /** Provider registry key, if resolved from TeamConfig providers dictionary */
  get providerName(): string | undefined;

  /** The underlying OpenAI client, for advanced use */
  get openai(): OpenAIAdapter;

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
  chat(
    agent: Agent,
    messages: ChatCompletionMessageParams[],
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[]
  ): Promise<string>;

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
  streamChat(
    agent: Agent,
    messages: ChatCompletionMessageParams[],
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[]
  ): AsyncIterable<string>;

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
  streamChat(
    agent: Agent,
    messages: ChatCompletionMessageParams[],
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[]
  ): AsyncIterable<string>;

  chatWithTools(
    agent: Agent,
    messages: ChatCompletionMessageParams[],
    tools: LlmToolDefinition[],
    executeTool: (toolCall: LlmToolCall) => Promise<LlmToolResult>,
    options?: LlmChatOptions,
    skills?: Skill[],
    teamRoster?: Agent[],
    maxToolRounds?: number,
    onToken?: (token: string) => void,
    instructions?: InstructionFile[]
  ): Promise<LlmToolChatResult>;

  /**
   * Low-level chat completion without an agent persona.
   * Useful during onboarding / init when no agents exist yet.
   *
   * @param systemPrompt - Custom system prompt
   * @param messages - Conversation messages
   * @param options - Optional overrides
   * @returns The assistant's reply text
   */
  rawChat(
    systemPrompt: string,
    messages: ChatCompletionMessageParams[],
    options?: LlmChatOptions
  ): Promise<string>;

  /**
   * Low-level streaming chat completion without an agent persona.
   */
  rawStreamChat(
    systemPrompt: string,
    messages: ChatCompletionMessageParams[],
    options?: LlmChatOptions
  ): AsyncIterable<string>;

  /**
   * Generate a short title (≤5 words) for a conversation.
   * Requires `initialize()` to have been called first.
   */
  generateTitle(messages: ChatMessage[]): Promise<string>;

  /**
   * Initialize from explicit config + apiKey (for use during init when
   * config.json may not exist yet).
   */
  initializeFromConfig(config: LlmConfig, apiKey?: string): void;
}

interface LlmProviderAdapter {
  kind: string;
  createClient(config: LlmConfig, apiKey?: string): OpenAIAdapter;
  getDefaultModel(config: LlmConfig): string;
}

export interface ResolvedLlmSettings {
  config: LlmConfig;
  options: LlmChatOptions;
  providerRef?: string;
  apiKeyEnvVar?: string;
  contextWindow?: number;
}

export interface IProviderRegistry {
  registerBuiltInAdapters(): void;
  registerLlmProviderAdapter(adapter: LlmProviderAdapter): void;
  getEffectiveContextWindow(
    providerConfig:
      | {
          contextWindow?: number;
          models?: Array<{ name: string; contextWindow?: number }>;
        }
      | undefined,
    modelKey?: string
  ): number | undefined;
  resolveSystemLlmSettings(teamConfig: TeamConfig, purposeKey: string): ResolvedLlmSettings;
  createLlmClient(config: LlmConfig, apiKey?: string): OpenAIAdapter;
  getDefaultModel(config: LlmConfig): string;
  testLlmConnection(config: LlmConfig, apiKey?: string): Promise<string>;
  fetchGitHubModels(): Promise<
    {
      id: string;
      name: string;
      contextWindow?: number;
      maxPromptTokens?: number;
      maxContextWindowTokens?: number;
      maxOutputTokens?: number;
    }[]
  >;
  fetchOpenAICompatibleModels(baseUrl: string, apiKey?: string): Promise<string[]>;
  fetchOpenAICompatibleModelsDetailed(
    baseUrl: string,
    apiKey?: string
  ): Promise<DiscoveredProviderModel[]>;
  getGitHubToken(): string;
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
    messages: ChatCompletionMessageParams[];
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

type ChatCompletionRequestPayload = Record<string, unknown>;

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
