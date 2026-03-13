import { describe, expect, it } from 'vitest';

import {
  requestInput,
  stripHandoffDirective,
} from './chat/index.js';
import type { ChatRuntimeHooks } from './chat/index.js';

// ---------------------------------------------------------------------------
// requestInput — setImmediate ordering
// ---------------------------------------------------------------------------
// Regression guard: requestInput uses setImmediate so any pending event-loop
// work drains before the readline prompt fires (e.g. CLI for-await loop
// draining runtimeQueue).
// ---------------------------------------------------------------------------

function makeHooks(answer: string): {
  hooks: ChatRuntimeHooks;
  order: string[];
} {
  const order: string[] = [];

  const hooks: ChatRuntimeHooks = {
    async questionInput(_req: Parameters<NonNullable<ChatRuntimeHooks['questionInput']>>[0]) {
      order.push('questionInput');
      return answer;
    },
  };

  return { hooks, order };
}

describe('requestInput — setImmediate ordering', () => {
  it('any setImmediate-scheduled work runs before questionInput', async () => {
    const { hooks, order } = makeHooks('hi');

    // Simulate a pending log event scheduled via setImmediate (as the CLI
    // for-await loop does when draining runtimeQueue).
    setImmediate(() => order.push('consumer:drained'));

    await requestInput(hooks, { message: 'Prompt:' });

    const drainIdx = order.indexOf('consumer:drained');
    const inputIdx = order.indexOf('questionInput');
    expect(drainIdx).toBeGreaterThanOrEqual(0);
    expect(inputIdx).toBeGreaterThan(drainIdx);
  });

  it('returns the value from questionInput', async () => {
    const { hooks } = makeHooks('my answer');
    const result = await requestInput(hooks, { message: 'Q:' });
    expect(result).toBe('my answer');
  });

  it('throws when no questionInput handler is provided', async () => {
    const hooks: ChatRuntimeHooks = {};
    await expect(requestInput(hooks, { message: 'Q:' })).rejects.toThrow(
      'Input question requested but no client questionInput responder is available.',
    );
  });
});



describe('stripHandoffDirective', () => {
  it('removes a bare HANDOFF: line', () => {
    const input = 'Sure thing!\nHANDOFF: engineer | pass to dev team\nLet me know.';
    const result = stripHandoffDirective(input);
    expect(result).toContain('Sure thing!');
    expect(result).toContain('Let me know.');
    expect(result).not.toMatch(/HANDOFF/i);
  });

  it('removes multiple HANDOFF: lines', () => {
    const input = 'HANDOFF: hr | go here\nSome text.\nHANDOFF:CEO| also here\nDone.';
    const result = stripHandoffDirective(input);
    expect(result).toContain('Some text.');
    expect(result).toContain('Done.');
    expect(result).not.toMatch(/HANDOFF/i);
  });

  it('is case-insensitive', () => {
    const input = 'Hello.\nhandoff: engineer | route it\nBye.';
    // Removing the directive line leaves one blank line; that is acceptable
    const result = stripHandoffDirective(input);
    expect(result).toContain('Hello.');
    expect(result).toContain('Bye.');
    expect(result).not.toMatch(/handoff/i);
  });

  it('handles leading/trailing whitespace on the directive line', () => {
    const input = 'Hi.\n   HANDOFF:CEO| urgent   \nThanks.';
    const result = stripHandoffDirective(input);
    expect(result).toContain('Hi.');
    expect(result).toContain('Thanks.');
    expect(result).not.toMatch(/HANDOFF/i);
  });

  it('collapses more than two consecutive blank lines left by removal', () => {
    const input = 'Start.\n\n\nHANDOFF: x | y\n\n\n\nEnd.';
    const result = stripHandoffDirective(input);
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain('Start.');
    expect(result).toContain('End.');
  });

  it('leaves text without a directive unchanged', () => {
    const input = 'This is a normal message.';
    expect(stripHandoffDirective(input)).toBe('This is a normal message.');
  });

  it('does not strip lines that merely mention handoff in a sentence', () => {
    const input = 'The handoff process is important.\nHANDOFF:CEO| do it\nProceed.';
    const result = stripHandoffDirective(input);
    expect(result).toContain('The handoff process is important.');
    expect(result).not.toContain('HANDOFF: cto');
  });

  it('returns empty string when input is only a HANDOFF directive', () => {
    expect(stripHandoffDirective('HANDOFF: engineer | go')).toBe('');
  });

  it('removes inline HANDOFF directive appended to normal text on same line', () => {
    const input = 'Sure — I can help. HANDOFF: hr-director | Please proceed.';
    const result = stripHandoffDirective(input);
    expect(result).toBe('Sure — I can help.');
    expect(result).not.toMatch(/HANDOFF/i);
  });

  it('returns trimmed result', () => {
    const input = '\n\nHANDOFF: x | y\n\n';
    expect(stripHandoffDirective(input)).toBe('');
  });
});

// detectForwardRequestWithFallback and REFERENCE_PRONOUNS tests live in
// packages/service/src/orchestrator/forward-detection.test.ts
