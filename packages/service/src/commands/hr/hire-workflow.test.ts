import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@ai-team/core';
import {
  CheckHireWorkflowCompletionCommand,
  FinalizeHireWorkflowCommand,
  HireWorkflow,
} from './hire-workflow.js';

describe('HireWorkflow', () => {
  it('defines the HR phase as a durable chat step with completion/finalization commands', () => {
    const workflow = new HireWorkflow();
    const definition = workflow.getDefinition();
    expect(definition.steps).toHaveLength(1);
    const step = definition.steps[0] as any;
    expect(step.kind).toBe('chat');
    expect(step.agentId).toBe('{{hrAgentId}}');
    expect(step.done.command).toBe('hr-check_hire_workflow_completion');
    expect(step.finalize.command).toBe('hr-finalize_hire_workflow');
    expect(step.chat.toolPolicy.allow).toEqual(['hr-hire_agent', 'com-ask', 'access-set_permissions']);
  });
});

describe('CheckHireWorkflowCompletionCommand', () => {
  it('rejects early return attempts with actionable feedback', async () => {
    const command = new CheckHireWorkflowCompletionCommand(async () => [
      {
        from: 'hr-director',
        to: 'human',
        content: 'I still need one more confirmation.',
        timestamp: new Date().toISOString(),
      } as ChatMessage,
    ]);

    await expect(command.execute({ exitWords: ['done'] }, { history: [], sessionId: 's-1' } as any))
      .resolves.toEqual({
        status: 'ok',
        data: {
          done: false,
          feedback: "Return was rejected. Finish hiring, apply permissions, then end the HR response with 'done'.",
        },
      });
  });

  it('accepts completion once the latest assistant message ends with done', async () => {
    const command = new CheckHireWorkflowCompletionCommand(async () => [
      {
        from: 'human',
        to: 'hr-director',
        isHuman: true,
        content: 'Any update?',
        timestamp: new Date().toISOString(),
      } as ChatMessage,
      {
        from: 'hr-director',
        to: 'human',
        content: 'Hiring completed. done',
        timestamp: new Date().toISOString(),
      } as ChatMessage,
    ]);

    await expect(command.execute({}, { history: [], sessionId: 's-1' } as any)).resolves.toEqual({
      status: 'ok',
      data: { done: true },
    });
  });
});

describe('FinalizeHireWorkflowCommand', () => {
  it('returns the persisted workflow chat transcript for the active session', async () => {
    const transcript: ChatMessage[] = [
      {
        from: 'human',
        to: 'hr-director',
        isHuman: true,
        content: 'Please hire a Head of Development.',
        timestamp: new Date().toISOString(),
      },
      {
        from: 'hr-director',
        to: 'human',
        content: 'Understood. done',
        timestamp: new Date().toISOString(),
      },
    ];
    const command = new FinalizeHireWorkflowCommand(async () => transcript);

    await expect(command.execute({}, { history: [], sessionId: 's-1' } as any)).resolves.toEqual({
      status: 'ok',
      data: { messages: transcript },
    });
  });
});
