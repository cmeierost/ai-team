import { describe, expect, it } from 'vitest';
import { runtimeEventToStreamEvent } from './runtime-event-translator.js';

describe('runtimeEventToStreamEvent', () => {
  it('maps known token event fields', () => {
    const mapped = runtimeEventToStreamEvent(
      { kind: 'token', text: 'hello' },
      { command: 'chat', timestamp: 't1' }
    );
    expect(mapped).toEqual({ kind: 'token', text: 'hello', command: 'chat', timestamp: 't1' });
  });

  it('drops malformed token events', () => {
    const mapped = runtimeEventToStreamEvent(
      { kind: 'token' } as unknown as { kind: 'token'; text: string },
      { command: 'chat', timestamp: 't1' }
    );
    expect(mapped).toBeNull();
  });

  it('passes through unknown event kinds', () => {
    const mapped = runtimeEventToStreamEvent({ kind: 'custom', payload: 1 } as unknown as any, {
      command: 'chat',
      timestamp: 't1',
    });
    expect(mapped).toEqual({ kind: 'custom', payload: 1, command: 'chat', timestamp: 't1' });
  });
});
