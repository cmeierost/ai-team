import { describe, expect, it } from 'vitest';
import { resolveChatInvocationTarget } from './chat-invocation-target.js';

describe('resolveChatInvocationTarget', () => {
  it('resumes the last active thread for a target-less chat', () => {
    expect(resolveChatInvocationTarget([], undefined, false)).toEqual({
      agentId: undefined,
      sessionId: undefined,
      createNewSession: false,
    });
  });

  it('starts a new root session for an agent-only chat', () => {
    expect(resolveChatInvocationTarget(['sarah-lee'], undefined, false)).toEqual({
      agentId: 'sarah-lee',
      sessionId: undefined,
      createNewSession: true,
    });
  });

  it('resumes a positional session at the thread active agent', () => {
    expect(
      resolveChatInvocationTarget(['session-2026-07-21-k40o63'], undefined, false)
    ).toEqual({
      agentId: undefined,
      sessionId: 'session-2026-07-21-k40o63',
      createNewSession: false,
    });
  });

  it('does not create a new session when an agent and session are supplied', () => {
    expect(
      resolveChatInvocationTarget(
        ['michael-brown', 'session-2026-07-21-k40o63'],
        undefined,
        false
      )
    ).toEqual({
      agentId: 'michael-brown',
      sessionId: 'session-2026-07-21-k40o63',
      createNewSession: false,
    });
  });
});
