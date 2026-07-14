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

  it('does not include legacy hardcoded handoff directive text', () => {
    const prompt = systemPromptBuilder.build({
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      systemPrompt: '',
    } as any);

    expect(prompt).not.toContain('To hand off with a message, include exactly one line: HANDOFF:');
    expect(prompt).not.toContain(
      'When the user asks to be forwarded or connected to another team member, acknowledge the handoff gracefully.'
    );
  });

  it('includes guidance to avoid transcript-style speaker labels in replies', () => {
    const prompt = systemPromptBuilder.build({
      id: 'michael-brown',
      name: 'Michael Brown',
      role: 'ceo',
      systemPrompt: '',
    } as any);

    expect(prompt).toContain(
      'Do not emit transcript speaker-label lines such as "Name -> Name:" or "Name → Name:" in normal replies; write only the reply content.'
    );
  });
});
