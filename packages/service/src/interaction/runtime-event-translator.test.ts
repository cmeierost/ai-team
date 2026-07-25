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

  it('preserves authoritative handoff and session-switch identity fields', () => {
    expect(
      runtimeEventToStreamEvent(
        {
          kind: 'handoff',
          handoffId: 'handoff-1',
          handoffPhase: 'complete',
          fromAgentId: 'michael',
          fromLlmModel: 'gpt-5.2',
          fromSessionId: 'session-michael',
          toAgentId: 'emily',
          toLlmModel: 'best-chat',
          toSessionId: 'session-emily',
          briefingContent: 'Continue from here.',
        },
        { command: 'chat', timestamp: 't1' }
      )
    ).toMatchObject({
      kind: 'handoff',
      handoffPhase: 'complete',
      fromAgentId: 'michael',
      fromLlmModel: 'gpt-5.2',
      toAgentId: 'emily',
      toLlmModel: 'best-chat',
      toSessionId: 'session-emily',
    });
    expect(
      runtimeEventToStreamEvent(
        {
          kind: 'session_switched',
          agentId: 'emily',
          sessionId: 'session-emily',
          source: 'handoff',
        },
        { command: 'chat', timestamp: 't2' }
      )
    ).toMatchObject({
      kind: 'session_switched',
      agentId: 'emily',
      sessionId: 'session-emily',
      source: 'handoff',
    });
  });

  it('passes through unknown event kinds', () => {
    const mapped = runtimeEventToStreamEvent({ kind: 'custom', payload: 1 } as unknown as any, {
      command: 'chat',
      timestamp: 't1',
    });
    expect(mapped).toEqual({ kind: 'custom', payload: 1, command: 'chat', timestamp: 't1' });
  });

  it('passes through workflow lifecycle events without adapter-side workflow logic', () => {
    const mapped = runtimeEventToStreamEvent(
      {
        kind: 'workflow_state',
        workflowId: 'init_onboarding',
        workflowInstanceId: 'wf-1',
        stateValue: 'chat_waiting',
        actorStatus: 'active',
      },
      { command: 'chat', timestamp: 't3' }
    );
    expect(mapped).toEqual({
      kind: 'workflow_state',
      workflowId: 'init_onboarding',
      workflowInstanceId: 'wf-1',
      stateValue: 'chat_waiting',
      actorStatus: 'active',
      command: 'chat',
      timestamp: 't3',
    });
  });
});
