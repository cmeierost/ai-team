import { describe, expect, it, vi } from 'vitest';
import {
  ChatRuntimeV2CliAdapter,
  type ICliChatV2TurnRunner,
} from './chat-runtime-v2-cli-adapter.js';

describe('ChatRuntimeV2CliAdapter', () => {
  it('runs through ChatRuntimeV2 and returns completed output text', async () => {
    const turnRunner: ICliChatV2TurnRunner = {
      runTurnAsync: vi.fn(async () => 'cli-output'),
    };

    const runtime = new ChatRuntimeV2CliAdapter(turnRunner);
    const output = await runtime.runAsync({ message: 'hello' });

    expect(output).toEqual({
      status: 'completed',
      text: 'cli-output',
      hopCount: 0,
    });
    expect(turnRunner.runTurnAsync).toHaveBeenCalledWith({
      message: 'hello',
      skipPersist: false,
    });
  });

  it('returns failed output when turn runner throws', async () => {
    const turnRunner: ICliChatV2TurnRunner = {
      runTurnAsync: vi.fn(async () => {
        throw new Error('runner-failure');
      }),
    };

    const runtime = new ChatRuntimeV2CliAdapter(turnRunner);
    const output = await runtime.runAsync({ message: 'hello' });

    expect(output.status).toBe('failed');
    expect(output.error).toBe('runner-failure');
  });

  it('forwards agentId and sessionId to the turn runner when provided', async () => {
    const turnRunner: ICliChatV2TurnRunner = {
      runTurnAsync: vi.fn(async () => 'cli-output'),
    };

    const runtime = new ChatRuntimeV2CliAdapter(turnRunner);
    await runtime.runAsync({ message: 'hello', agentId: 'alex-morgan', sessionId: 'session-123' });

    expect(turnRunner.runTurnAsync).toHaveBeenCalledWith({
      message: 'hello',
      skipPersist: false,
      agentId: 'alex-morgan',
      sessionId: 'session-123',
    });
  });
});
