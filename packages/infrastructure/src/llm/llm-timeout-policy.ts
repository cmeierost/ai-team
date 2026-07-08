import type { LlmConfig } from '@ai-team/core';

export class LlmTimeoutPolicy {
  private readonly defaultChatRequestTimeoutMs = 30_000;
  private readonly openAiGpt5ChatRequestTimeoutMs = 90_000;

  shouldUseResponsesApiForToolLoop(config: LlmConfig, model?: string): boolean {
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

  getChatRequestTimeoutMs(config: LlmConfig, model?: string): number {
    if (!model || config.provider !== 'openai-compatible' || !config.baseUrl) {
      return this.defaultChatRequestTimeoutMs;
    }

    let hostname: string;
    try {
      hostname = new URL(config.baseUrl).hostname.toLowerCase();
    } catch {
      return this.defaultChatRequestTimeoutMs;
    }

    if (hostname === 'api.openai.com' && model.toLowerCase().startsWith('gpt-5')) {
      return this.openAiGpt5ChatRequestTimeoutMs;
    }

    return this.defaultChatRequestTimeoutMs;
  }

  resolveResponsesContentTypeForRole(
    role: 'system' | 'user' | 'assistant'
  ): 'input_text' | 'output_text' {
    return role === 'assistant' ? 'output_text' : 'input_text';
  }
}
