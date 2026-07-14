import { describe, expect, it } from 'vitest';
import { LlmTitleFallbackService } from './llm-title-fallback.js';

const titleFallbackService = new LlmTitleFallbackService();

describe('title quality helpers', () => {
  it('derives a meaningful retirement-planning fallback title', () => {
    const title = titleFallbackService.deriveFallbackTitle([
      {
        isHuman: true,
        content: 'we want to plan how to retire agents',
      } as any,
      {
        isHuman: true,
        content: 'archive old agents and close lifecycle tasks',
      } as any,
    ]);

    expect(title).toBe('Plan Agent Retirement');
  });

  it('marks filler-heavy nonsense title as weak', () => {
    expect(titleFallbackService.isWeakGeneratedTitle('Let Plan Future Want')).toBe(true);
  });

  it('marks titles starting with Let as weak', () => {
    expect(titleFallbackService.isWeakGeneratedTitle('Let Test Title Generated')).toBe(true);
  });

  it('accepts specific action-oriented title', () => {
    expect(titleFallbackService.isWeakGeneratedTitle('Plan Agent Retirement')).toBe(false);
  });
});
