import { describe, expect, it } from 'vitest';
import { LlmSystemPromptBuilder } from './llm-system-prompt.js';

const systemPromptBuilder = new LlmSystemPromptBuilder();

describe('buildSystemPrompt questioning guidance', () => {
  it('includes ask-when-needed and stop-when-clear guardrails', () => {
    const prompt = systemPromptBuilder.build({
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      systemPrompt: '',
    } as any);

    expect(prompt).toContain(
      'Be curious and proactive: ask concise clarifying questions when requirements, constraints, or success criteria are ambiguous.'
    );
    expect(prompt).toContain(
      'Stop asking questions once you have enough information to act; do not ask repetitive or low-value questions.'
    );
    expect(prompt).toContain(
      'Ask at most one high-impact clarification at a time unless the developer explicitly requests a questionnaire.'
    );
  });
});
