import { describe, expect, it } from 'vitest';
import { resolveWorkflowChatDefinition } from './workflow-chat-definition.js';
import type { WorkflowChatStep } from './workflow-types.js';

describe('resolveWorkflowChatDefinition', () => {
  it('resolves chat, completion, and finalizer inputs from parent state', () => {
    const step: WorkflowChatStep<{ agentId: string; documentPath: string }> = {
      kind: 'chat', id: 'business-definition', agentId: '{{agentId}}',
      chat: { systemPrompt: 'Write {{documentPath}}', toolPolicy: { allow: ['docs_write', 'com_ask'] } },
      done: { command: 'business-check', args: { documentPath: '{{documentPath}}' } },
      finalize: { command: 'business-finalize', args: { documentPath: '{{documentPath}}' } },
    };
    expect(resolveWorkflowChatDefinition(step, { agentId: 'ceo-1', documentPath: '.ai-team/business.md' })).toEqual({
      agentId: 'ceo-1', systemPrompt: 'Write .ai-team/business.md', toolAllowlist: ['docs_write', 'com_ask'],
      done: { command: 'business-check', args: { documentPath: '.ai-team/business.md' } },
      finalize: { command: 'business-finalize', args: { documentPath: '.ai-team/business.md' } },
    });
  });
});
