import type { LlmConfig } from '@ai-team/core';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

type ChatCompletionRequestPayload = Record<string, unknown>;

export class LlmProviderNormalizationService {
  hasReasoningOnlyCompletion(response: unknown): boolean {
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

      const messageText = this.extractMessageContentText(message?.content);
      if (messageText) return false;

      const directText = (choice as { text?: unknown } | undefined)?.text;
      if (typeof directText === 'string' && directText.trim().length > 0) return false;

      const reasoningText =
        this.extractMessageContentText(message?.reasoning) ||
        this.extractMessageContentText(message?.reasoning_content);

      return reasoningText.length > 0;
    });
  }

  buildDisableThinkingFallbackRequest(
    config: LlmConfig,
    request: ChatCompletionRequestPayload,
    response: unknown
  ): ChatCompletionRequestPayload | undefined {
    if (config.provider !== 'openai-compatible') return undefined;
    if (!this.hasReasoningOnlyCompletion(response)) return undefined;

    const existing = this.toRecord(request.chat_template_kwargs);
    if (existing.enable_thinking === false) return undefined;

    return {
      ...request,
      chat_template_kwargs: {
        ...existing,
        enable_thinking: false,
      },
    };
  }

  normalizeMessagesForProvider(
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
      .map((message) => this.extractMessageContentText(message.content))
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

  private toRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }
}
