import { execSync } from 'node:child_process';
import OpenAI from 'openai';
import type { LlmConfig } from '@ai-team/core';

const GITHUB_COPILOT_API_URL = 'https://api.individual.githubcopilot.com';
const DEFAULT_COPILOT_MODEL = 'gpt-4o';
const TEST_CONNECTION_TIMEOUT_MS = 20_000;
const GITHUB_TOKEN_TIMEOUT_MS = 15_000;

interface LlmProviderAdapter {
  kind: string;
  createClient(config: LlmConfig, apiKey?: string): OpenAI;
  getDefaultModel(config: LlmConfig): string;
}

export class LlmProviderClient {
  private readonly llmProviderAdapters = new Map<string, LlmProviderAdapter>();

  constructor() {
    this.registerBuiltInAdapters();
  }

  registerLlmProviderAdapter(adapter: LlmProviderAdapter): void {
    this.llmProviderAdapters.set(adapter.kind, adapter);
  }

  createLlmClient(config: LlmConfig, apiKey?: string): OpenAI {
    const adapter = this.llmProviderAdapters.get(config.provider);
    if (!adapter) {
      throw new Error(`No provider adapter registered for: ${config.provider}`);
    }
    return adapter.createClient(config, apiKey);
  }

  getDefaultModel(config: LlmConfig): string {
    const adapter = this.llmProviderAdapters.get(config.provider);
    if (!adapter) {
      throw new Error(`No provider adapter registered for: ${config.provider}`);
    }
    return adapter.getDefaultModel(config);
  }

  async testLlmConnection(config: LlmConfig, apiKey?: string): Promise<string> {
    const client = this.createLlmClient(config, apiKey);
    const model = this.getDefaultModel(config);

    const response = await this.withTimeout(
      client.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: 'Reply with exactly: "Connection successful!" and nothing else.',
          },
        ],
        max_tokens: 20,
      }),
      TEST_CONNECTION_TIMEOUT_MS,
      `LLM connection test timed out after ${TEST_CONNECTION_TIMEOUT_MS / 1000}s. Check network, provider URL, and credentials.`
    );

    const text = this.extractChatCompletionText(response);
    if (text) return text;
    if (this.hasNonTextCompletionSignal(response))
      return 'Connection successful (non-text completion)';
    throw new Error('LLM returned an empty response');
  }

  private registerBuiltInAdapters(): void {
    if (this.llmProviderAdapters.size > 0) return;

    this.llmProviderAdapters.set('github-copilot', {
      kind: 'github-copilot',
      createClient: () => {
        const token = this.getGitHubToken();
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

    this.llmProviderAdapters.set('openai-compatible', {
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

  private extractChatCompletionText(response: unknown): string {
    const choices = (response as { choices?: unknown[] } | undefined)?.choices;
    if (!Array.isArray(choices) || choices.length === 0) return '';

    for (const choice of choices) {
      const message = (choice as { message?: { content?: unknown } } | undefined)?.message;
      const messageText = this.extractMessageContentText(message?.content);
      if (messageText) return messageText;

      const directText = (choice as { text?: unknown } | undefined)?.text;
      if (typeof directText === 'string' && directText.trim().length > 0) return directText.trim();
    }

    return '';
  }

  private extractMessageContentText(content: unknown): string {
    if (typeof content === 'string') return content.trim();

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

    if (!Array.isArray(content)) return '';

    const parts: string[] = [];
    for (const part of content) {
      if (!part || typeof part !== 'object') continue;

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

  private hasNonTextCompletionSignal(response: unknown): boolean {
    const choices = (response as { choices?: unknown[] } | undefined)?.choices;
    if (!Array.isArray(choices) || choices.length === 0) return false;

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
        this.extractMessageContentText(message?.reasoning) ||
        this.extractMessageContentText(message?.reasoning_content);
      if (reasoning.length > 0) return true;

      if (Array.isArray(message?.tool_calls) && message.tool_calls.length > 0) return true;
      if (message?.function_call) return true;

      const finishReason = (choice as { finish_reason?: unknown } | undefined)?.finish_reason;
      return typeof finishReason === 'string' && finishReason.trim().length > 0;
    });
  }

  private async withTimeout<T>(
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
      if (timer) clearTimeout(timer);
    }
  }

  private getGitHubToken(): string {
    try {
      const token = execSync('gh auth token', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: GITHUB_TOKEN_TIMEOUT_MS,
      }).trim();
      if (!token) throw new Error('gh auth token returned empty');
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
}
