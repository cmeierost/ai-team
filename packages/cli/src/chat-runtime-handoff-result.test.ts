import { describe, expect, it } from 'vitest';
import { requireSuccessfulHandoffTransition } from './chat-runtime-handoff-result.js';

describe('requireSuccessfulHandoffTransition', () => {
  it('rejects a cancelled handoff instead of scheduling an acknowledgement', () => {
    expect(() =>
      requireSuccessfulHandoffTransition({
        status: 'cancelled',
        message: 'Handoff was not approved.',
      })
    ).toThrow('Handoff was not approved.');
  });

  it('returns the authoritative target identity for a successful handoff', () => {
    expect(
      requireSuccessfulHandoffTransition({
        status: 'ok',
        data: {
          targetAgentId: 'sarah-lee',
          targetSessionId: 'session-sarah',
        },
      })
    ).toEqual({
      targetAgentId: 'sarah-lee',
      targetSessionId: 'session-sarah',
    });
  });
});
