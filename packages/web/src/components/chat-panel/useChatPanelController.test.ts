import { describe, expect, it } from 'vitest';
import {
  awaitUnlessCancelled,
  isWorkflowRuntimeEventKind,
  resolveWorkflowRuntimeErrorMessage,
  shouldSkipDuplicateGreetingSpeech,
} from './useChatPanelController';

describe('awaitUnlessCancelled', () => {
  it('returns resolved value when token is active', async () => {
    await expect(awaitUnlessCancelled(Promise.resolve('ok'), { value: false })).resolves.toBe('ok');
  });

  it('returns undefined when token was cancelled before resolution', async () => {
    let resolvePromise: ((value: string) => void) | undefined;
    const delayed = new Promise<string>((resolve) => {
      resolvePromise = resolve;
    });
    const token = { value: false };

    const resultPromise = awaitUnlessCancelled(delayed, token);
    token.value = true;
    resolvePromise?.('late');

    await expect(resultPromise).resolves.toBeUndefined();
  });
});

describe('shouldSkipDuplicateGreetingSpeech', () => {
  it('skips same greeting fingerprint inside dedupe window', () => {
    expect(
      shouldSkipDuplicateGreetingSpeech('agent-a::hello', 'agent-a::hello', 1000, 2500, 2000)
    ).toBe(true);
  });

  it('does not skip same greeting fingerprint after dedupe window', () => {
    expect(
      shouldSkipDuplicateGreetingSpeech('agent-a::hello', 'agent-a::hello', 1000, 3501, 2000)
    ).toBe(false);
  });

  it('does not skip different greeting fingerprint', () => {
    expect(
      shouldSkipDuplicateGreetingSpeech('agent-a::hello', 'agent-a::different', 1000, 1500, 2000)
    ).toBe(false);
  });
});

describe('workflow runtime event helpers', () => {
  it('classifies workflow lifecycle/runtime event kinds as non-chat transitions', () => {
    expect(isWorkflowRuntimeEventKind('workflow_started')).toBe(true);
    expect(isWorkflowRuntimeEventKind('workflow_state')).toBe(true);
    expect(isWorkflowRuntimeEventKind('token')).toBe(false);
  });

  it('resolves structured workflow terminal errors with fallback messaging', () => {
    expect(
      resolveWorkflowRuntimeErrorMessage({
        kind: 'workflow_failed',
        workflowId: 'init_onboarding',
        stepId: 'ceo_chat',
        message: 'workflow failed: timeout',
      })
    ).toBe('workflow failed: timeout');

    expect(
      resolveWorkflowRuntimeErrorMessage({
        kind: 'workflow_cancelled',
        workflowId: 'init_onboarding',
      })
    ).toBe('Workflow init_onboarding was cancelled.');

    expect(
      resolveWorkflowRuntimeErrorMessage({
        kind: 'workflow_state',
        workflowId: 'init_onboarding',
      })
    ).toBeNull();
  });
});
