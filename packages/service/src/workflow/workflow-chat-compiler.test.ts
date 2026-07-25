import { describe, expect, it } from 'vitest';
import { createActor, waitFor } from 'xstate';
import { compileWorkflowChatStep } from './workflow-chat-compiler.js';
import type { WorkflowChatStep } from './workflow-types.js';

describe('compileWorkflowChatStep', () => {
  it('uses command-backed completion and finalization in the durable child lifecycle', async () => {
    const checks = [{ done: false, feedback: 'Needs approval.' }, { done: true }];
    const step: WorkflowChatStep<{ documentPath: string }> = {
      kind: 'chat', id: 'business',
      chat: { systemPrompt: 'Write {{documentPath}}', toolPolicy: { allow: ['docs_write'] } },
      done: { command: 'check', args: { path: '{{documentPath}}' } },
      finalize: { command: 'finalize', args: { path: '{{documentPath}}' } },
    };
    const actor = createActor(compileWorkflowChatStep(step, { documentPath: 'business.md' }, {
      processTurn: async () => ({}),
      invoke: async (command, args) => command === 'check'
        ? checks.shift()!
        : { approved: true, path: args?.path },
    }), { input: { sessionId: 'ceo-session', systemPrompt: 'Write business.md', toolAllowlist: ['docs_write'] } }).start();

    actor.send({ type: 'RETURN_ATTEMPT' });
    await waitFor(actor, (snapshot) => snapshot.value === 'conversing' && snapshot.context.feedback === 'Needs approval.');
    actor.send({ type: 'RETURN_ATTEMPT' });
    await waitFor(actor, (snapshot) => snapshot.status === 'done');

    expect(actor.getSnapshot().output).toEqual({ approved: true, path: 'business.md' });
  });
});
