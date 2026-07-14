import { describe, expect, it } from 'vitest';

import {
  chatHandoffTransitionResultSchema,
  chatPostTurnOutcomeSchema,
  chatPreturnResultSchema,
  chatSendTurnResultSchema,
  chatToolRoundResultSchema,
  chatWorkflowIdSchema,
  parseChatHandoffTransitionResult,
  parseChatPostTurnResolutionResult,
  parseChatPreturnResult,
  parseChatSendTurnResult,
  parseChatToolRoundResult,
  workflowSessionPolicySchema,
  workflowToolPolicySchema,
} from './chat-loop-contracts.js';

describe('chat-loop-contracts', () => {
  it('accepts valid chat post-turn outcomes', () => {
    expect(chatPostTurnOutcomeSchema.parse('normal_complete')).toBe('normal_complete');
    expect(chatPostTurnOutcomeSchema.parse('handoff_required')).toBe('handoff_required');
  });

  it('rejects hire_complete as a chat post-turn outcome', () => {
    expect(() => chatPostTurnOutcomeSchema.parse('hire_complete')).toThrow();
  });

  it('chat workflow ids migrated to XState-based WorkflowRunner', () => {
    // Legacy enum-based workflow IDs removed
    expect(chatWorkflowIdSchema.isOptional()).toBe(true);
  });

  it('validates a post-turn handoff resolution payload', () => {
    const parsed = parseChatPostTurnResolutionResult({
      outcome: 'handoff_required',
      handoffTargetId: 'michael-brown',
      handoffNote: 'Please take over.',
    });

    expect(parsed).toMatchObject({
      outcome: 'handoff_required',
      handoffTargetId: 'michael-brown',
    });
  });

  it('accepts workflow tool policy overlays', () => {
    const parsed = workflowToolPolicySchema.parse({
      allow: ['fs_read'],
      deny: ['hr_hire'],
      add: ['tool_list'],
      remove: ['fs_apply_patch'],
    });

    expect(parsed.deny).toContain('hr_hire');
  });

  it('requires explicit session mode in workflow session policy', () => {
    expect(() => workflowSessionPolicySchema.parse({})).toThrow();
    const parsed = workflowSessionPolicySchema.parse({ mode: 'handoff_thread' });
    expect(parsed.mode).toBe('handoff_thread');
  });

  it('validates preturn contract outcomes', () => {
    const parsed = parseChatPreturnResult({ outcome: 'forwarded', autoMessage: 'auto-react' });
    expect(parsed).toEqual({ outcome: 'forwarded', autoMessage: 'auto-react' });
    expect(() => chatPreturnResultSchema.parse({ outcome: 'unknown' })).toThrow();
  });

  it('validates send-turn result with pending tool call', () => {
    const parsed = parseChatSendTurnResult({
      text: 'Need tool',
      toolRoundNeeded: true,
      pendingToolCall: { toolName: 'fs_read', args: { filePath: 'README.md' } },
    });
    expect(parsed.toolRoundNeeded).toBe(true);
    expect(parsed.pendingToolCall?.toolName).toBe('fs_read');
    expect(() => chatSendTurnResultSchema.parse({ toolRoundNeeded: true })).toThrow();
  });

  it('validates tool-round outcomes', () => {
    expect(parseChatToolRoundResult({ outcome: 'resume_llm' }).outcome).toBe('resume_llm');
    expect(parseChatToolRoundResult({ outcome: 'tool_complete' }).outcome).toBe('tool_complete');
    expect(parseChatToolRoundResult({ outcome: 'tool_failed', error: 'denied' }).error).toBe(
      'denied'
    );
    expect(() => chatToolRoundResultSchema.parse({ outcome: 'invalid' })).toThrow();
  });

  it('validates handoff transition result payload', () => {
    expect(chatHandoffTransitionResultSchema.parse({ autoMessage: 'hello' })).toEqual({
      autoMessage: 'hello',
    });
    expect(parseChatHandoffTransitionResult({})).toEqual({});
  });
});
