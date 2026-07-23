import { describe, expect, it } from 'vitest';
import { isCommandResponse } from './shared-types.js';

describe('isCommandResponse', () => {
  it('recognizes cancelled responses as command responses', () => {
    expect(
      isCommandResponse({
        status: 'cancelled',
        message: 'Handoff was not approved.',
        data: {
          type: 'handoff_cancelled',
          outcome: 'cancelled',
          targetAgentId: 'sarah-lee',
          reasonCode: 'approval-denied',
        },
      })
    ).toBe(true);
  });
});
