import { describe, expect, it } from 'vitest';
import { runtimeEventToStreamEvent } from './runtime-event-translator.js';

describe('runtimeEventToStreamEvent', () => {
  const base = {
    requestId: 'req-1',
    command: 'chat' as const,
    timestamp: '2026-05-07T12:00:00.000Z',
  };

  it('passes through runtime events that already match the stream contract', () => {
    expect(
      runtimeEventToStreamEvent(
        {
          kind: 'status',
          phase: 'thinking',
          message: 'Working on it',
        },
        base
      )
    ).toEqual({
      ...base,
      kind: 'status',
      phase: 'thinking',
      message: 'Working on it',
    });

    expect(
      runtimeEventToStreamEvent(
        {
          kind: 'session_title_updated',
          sessionId: 'session-1',
          title: 'Fresh title',
        },
        base
      )
    ).toEqual({
      ...base,
      kind: 'session_title_updated',
      sessionId: 'session-1',
      title: 'Fresh title',
    });
  });

  it('normalizes log events to always include a message', () => {
    expect(runtimeEventToStreamEvent({ kind: 'log' }, base)).toEqual({
      ...base,
      kind: 'log',
      message: '',
    });
  });

  it('drops runtime events whose required stream fields are missing', () => {
    expect(runtimeEventToStreamEvent({ kind: 'token' }, base)).toBeNull();
    expect(runtimeEventToStreamEvent({ kind: 'tool' }, base)).toBeNull();
    expect(runtimeEventToStreamEvent({ kind: 'question' }, base)).toBeNull();
    expect(runtimeEventToStreamEvent({ kind: 'handoff' }, base)).toBeNull();
  });

  it('keeps guarded runtime events when required fields are present', () => {
    expect(runtimeEventToStreamEvent({ kind: 'token', text: 'hello' }, base)).toEqual({
      ...base,
      kind: 'token',
      text: 'hello',
    });

    expect(
      runtimeEventToStreamEvent(
        {
          kind: 'tool',
          toolName: 'read_file',
          toolPhase: 'start',
        },
        base
      )
    ).toEqual({
      ...base,
      kind: 'tool',
      toolName: 'read_file',
      toolPhase: 'start',
    });

    expect(
      runtimeEventToStreamEvent(
        {
          kind: 'question',
          message: 'Proceed?',
          questionType: 'confirm',
        },
        base
      )
    ).toEqual({
      ...base,
      kind: 'question',
      message: 'Proceed?',
      questionType: 'confirm',
    });

    expect(
      runtimeEventToStreamEvent(
        {
          kind: 'handoff',
          fromAgentId: 'alex-morgan',
          toAgentId: 'leah-brooks',
          message: 'Passing this over',
        },
        base
      )
    ).toEqual({
      ...base,
      kind: 'handoff',
      fromAgentId: 'alex-morgan',
      toAgentId: 'leah-brooks',
      message: 'Passing this over',
    });
  });
});