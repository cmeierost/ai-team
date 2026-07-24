import { describe, expect, it, vi } from 'vitest';
import { HandoffCommand, HandoffCommandMetadata } from './handoff.command.js';

const SOURCE = {
  id: 'michael',
  name: 'Michael Brown',
  role: 'CEO',
  handoffs: [],
};
const TARGET = {
  id: 'emily',
  name: 'Emily Davis',
  role: 'HR Director',
};

function createCommand(askAnswer = false, source = SOURCE) {
  const transition = {
    fromAgent: source,
    targetAgent: TARGET,
    fromSessionId: 'session-michael',
    toSessionId: 'session-emily',
    briefingContent: 'A useful summary.',
    history: [],
    handoffId: 'handoff-1',
    navigationStack: [
      { agentId: 'michael', agentName: 'Michael Brown', sessionId: 'session-michael' },
    ],
  };
  const handoffSubWorkflow = {
    executeAsync: vi.fn(async () => transition),
  } as any;
  const emitService = { emit: vi.fn() } as any;
  const agentManager = {
    resolveAgentForOperationAsync: vi.fn(async (query: string) =>
      query === source.id ? source : TARGET
    ),
    getAgentAsync: vi.fn(async (id: string) => (id === source.id ? source : TARGET)),
  } as any;
  const commandDispatcher = {
    dispatch: vi.fn(async () => ({
      status: 'ok',
      message: 'answered',
      data: { type: 'com_ask_result', answer: askAnswer },
    })),
  } as any;
  return {
    command: new HandoffCommand(handoffSubWorkflow, emitService, agentManager, commandDispatcher),
    handoffSubWorkflow,
    commandDispatcher,
  };
}

describe('HandoffCommand delegation approval', () => {
  it('advertises report-back requests as real handoffs with a useful briefing', () => {
    expect(HandoffCommandMetadata.description).toContain(
      'tell, report back to, or return to another agent'
    );
    expect(HandoffCommand.schema.shape.briefingNote.description).toContain(
      'answer or conclusions'
    );
  });

  it.each([['slash', true], ['workflow', false]] as const)(
    'returns the same typed transition result for the %s invocation surface',
    async (invocationSurface, calledByHuman) => {
      const source = {
        ...SOURCE,
        handoffs: [{ label: 'HR', agent: 'emily' }],
      };
      const { command } = createCommand(false, source);

      const result = await command.execute(
        { targetAgentId: 'emily', targetWorkflowId: 'chat' },
        {
          history: [],
          agent: source as any,
          agentId: source.id,
          sessionId: 'session-michael',
          invocationSurface,
          calledByHuman,
        }
      );

      expect(result).toMatchObject({
        status: 'ok',
        data: {
          type: 'handoff',
          targetAgentId: 'emily',
          targetSessionId: 'session-emily',
          targetWorkflowId: 'chat',
          briefingNote: 'A useful summary.',
        },
      });
    }
  );

  it('returns a declarative request for a model tool call without applying the transition', async () => {
    const source = {
      ...SOURCE,
      handoffs: [{ label: 'HR', agent: 'emily' }],
    };
    const { command, handoffSubWorkflow, commandDispatcher } = createCommand(false, source);

    const result = await command.execute(
      { targetAgentId: 'emily', targetWorkflowId: 'chat', briefingNote: 'Please take over.' },
      {
        history: [],
        agent: source as any,
        agentId: source.id,
        sessionId: 'session-michael',
        invocationSurface: 'tool',
        calledByHuman: false,
      }
    );

    expect(result).toMatchObject({
      status: 'ok',
      data: {
        type: 'handoff',
        targetAgentId: 'emily',
        briefingNote: 'Please take over.',
      },
    });
    expect(handoffSubWorkflow.executeAsync).not.toHaveBeenCalled();
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('allows a trusted human slash handoff to any valid agent without asking', async () => {
    const { command, handoffSubWorkflow, commandDispatcher } = createCommand();

    const result = await command.execute(
      { targetAgentId: 'emily', targetWorkflowId: 'chat' },
      {
        history: [],
        agent: SOURCE as any,
        sessionId: 'session-michael',
        invocationSurface: 'slash',
        calledByHuman: true,
      }
    );

    expect(result.status).toBe('ok');
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    expect(handoffSubWorkflow.executeAsync).toHaveBeenCalledOnce();
  });

  it('passes workflow return navigation through to the handoff subworkflow', async () => {
    const { command, handoffSubWorkflow } = createCommand();

    const result = await command.execute(
      {
        targetAgentId: 'emily',
        targetWorkflowId: 'chat',
        navigationIntent: 'back',
      },
      {
        history: [],
        agent: SOURCE as any,
        sessionId: 'session-michael',
        invocationSurface: 'slash',
        calledByHuman: true,
      }
    );

    expect(result.status).toBe('ok');
    expect(handoffSubWorkflow.executeAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAgentQuery: 'emily',
        navigationIntent: 'back',
      })
    );
  });

  it('defers confirmation for an unconfigured model handoff to the runtime transition', async () => {
    const { command, handoffSubWorkflow, commandDispatcher } = createCommand(false);

    const result = await command.execute(
      { targetAgentId: 'emily', targetWorkflowId: 'chat' },
      {
        history: [],
        agent: SOURCE as any,
        sessionId: 'session-michael',
        invocationSurface: 'tool',
        calledByHuman: false,
      }
    );

    expect(result.status).toBe('ok');
    expect(result.data).toMatchObject({
      type: 'handoff',
      targetAgentId: 'emily',
    });
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    expect(handoffSubWorkflow.executeAsync).not.toHaveBeenCalled();
  });

  it.each(['workflow'] as const)(
    'does not trust calledByHuman on the %s invocation surface',
    async (invocationSurface) => {
      const { command, handoffSubWorkflow, commandDispatcher } = createCommand(false);

      const result = await command.execute(
        { targetAgentId: 'emily', targetWorkflowId: 'chat' },
        {
          history: [],
          agent: SOURCE as any,
          sessionId: 'session-michael',
          invocationSurface,
          calledByHuman: true,
        }
      );

      expect(result.status).toBe('cancelled');
      expect(commandDispatcher.dispatch).toHaveBeenCalledOnce();
      expect(handoffSubWorkflow.executeAsync).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['timeout', { status: 'error', message: 'Question timed out.' }, 'approval-timeout'],
    [
      'missing question capability',
      { status: 'error', message: 'Question service unavailable.' },
      'approval-unavailable',
    ],
    [
      'cancelled question',
      { status: 'cancelled', message: 'Question cancelled.' },
      'approval-cancelled',
    ],
  ])(
    'returns a typed cancellation with no transition side effects for %s',
    async (_label, approvalResponse, expectedReason) => {
      const { command, handoffSubWorkflow, commandDispatcher } = createCommand(false);
      commandDispatcher.dispatch.mockResolvedValueOnce(approvalResponse);
      const ctx = {
        history: [],
        agent: SOURCE as any,
        agentId: SOURCE.id,
        sessionId: 'session-michael',
        invocationSurface: 'workflow' as const,
        calledByHuman: false,
      };

      const result = await command.execute(
        { targetAgentId: 'emily', targetWorkflowId: 'chat' },
        ctx
      );

      expect(result).toMatchObject({
        status: 'cancelled',
        data: {
          type: 'handoff_cancelled',
          reasonCode: expectedReason,
          targetAgentId: 'emily',
        },
      });
      expect(handoffSubWorkflow.executeAsync).not.toHaveBeenCalled();
      expect(ctx).toMatchObject({
        agentId: SOURCE.id,
        sessionId: 'session-michael',
      });
    }
  );

  it('does not apply a configured model handoff before the runtime transition', async () => {
    const { command, handoffSubWorkflow, commandDispatcher } = createCommand();
    const source = {
      ...SOURCE,
      handoffs: [{ label: 'HR', agent: 'emily' }],
    };

    const result = await command.execute(
      { targetAgentId: 'emily', targetWorkflowId: 'chat' },
      {
        history: [],
        agent: source as any,
        sessionId: 'session-michael',
        invocationSurface: 'tool',
        calledByHuman: false,
      }
    );

    expect(result.status).toBe('ok');
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    expect(handoffSubWorkflow.executeAsync).not.toHaveBeenCalled();
  });

  it('resolves the source agent from agentId before applying configured handoffs', async () => {
    const source = {
      ...SOURCE,
      handoffs: [{ label: 'Architecture', agent: 'emily' }],
    };
    const { command, handoffSubWorkflow, commandDispatcher } = createCommand(false, source);

    const result = await command.execute(
      { targetAgentId: 'emily', targetWorkflowId: 'chat' },
      {
        history: [],
        agentId: source.id,
        sessionId: 'session-michael',
        invocationSurface: 'cli',
        calledByHuman: true,
      }
    );

    expect(result.status).toBe('ok');
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    expect(handoffSubWorkflow.executeAsync).toHaveBeenCalledOnce();
  });

  it('uses the normal transition after an unconfigured target is approved', async () => {
    const { command, handoffSubWorkflow, commandDispatcher } = createCommand(true);

    const result = await command.execute(
      { targetAgentId: 'emily', targetWorkflowId: 'chat' },
      {
        history: [],
        agent: SOURCE as any,
        sessionId: 'session-michael',
        invocationSurface: 'workflow',
        calledByHuman: false,
      }
    );

    expect(result.status).toBe('ok');
    expect(commandDispatcher.dispatch).toHaveBeenCalledOnce();
    expect(handoffSubWorkflow.executeAsync).toHaveBeenCalledOnce();
  });

  it('does not request a second approval when applying an already accepted tool handoff', async () => {
    const { command, handoffSubWorkflow, commandDispatcher } = createCommand(false);

    const result = await command.execute(
      { targetAgentId: 'emily', targetWorkflowId: 'chat' },
      {
        history: [],
        agent: SOURCE as any,
        sessionId: 'session-michael',
        invocationSurface: 'cli',
        calledByHuman: false,
        handoffAlreadyAuthorized: true,
      }
    );

    expect(result.status).toBe('ok');
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    expect(handoffSubWorkflow.executeAsync).toHaveBeenCalledOnce();
  });

  it('rejects self-handoff before asking or changing state', async () => {
    const { command, handoffSubWorkflow, commandDispatcher } = createCommand();
    (command as any).agentManager.resolveAgentForOperationAsync.mockResolvedValue(SOURCE);
    (command as any).agentManager.getAgentAsync.mockResolvedValue(SOURCE);

    const result = await command.execute(
      { targetAgentId: 'michael', targetWorkflowId: 'chat' },
      {
        history: [],
        agent: SOURCE as any,
        sessionId: 'session-michael',
        invocationSurface: 'tool',
      }
    );

    expect(result).toMatchObject({ status: 'error' });
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    expect(handoffSubWorkflow.executeAsync).not.toHaveBeenCalled();
  });

  it('explains an explicit slash self-handoff in developer-facing language', async () => {
    const { command, handoffSubWorkflow, commandDispatcher } = createCommand();
    (command as any).agentManager.resolveAgentForOperationAsync.mockResolvedValue(SOURCE);
    (command as any).agentManager.getAgentAsync.mockResolvedValue(SOURCE);

    const result = await command.execute(
      { targetAgentId: 'michael', targetWorkflowId: 'chat' },
      {
        history: [],
        agent: SOURCE as any,
        sessionId: 'session-michael',
        invocationSurface: 'slash',
        calledByHuman: true,
      }
    );

    expect(result).toMatchObject({
      status: 'error',
      message: 'You are already talking to Michael Brown. Choose another agent for the handoff.',
    });
    expect(commandDispatcher.dispatch).not.toHaveBeenCalled();
    expect(handoffSubWorkflow.executeAsync).not.toHaveBeenCalled();
  });

  it('keeps runtime identity unchanged when the shared transition fails', async () => {
    const source = {
      ...SOURCE,
      handoffs: [{ label: 'HR', agent: 'emily' }],
    };
    const { command, handoffSubWorkflow } = createCommand(false, source);
    handoffSubWorkflow.executeAsync.mockRejectedValueOnce(new Error('persistence failed'));
    const ctx = {
      history: [{ from: 'michael', content: 'private context' }],
      agent: source as any,
      agentId: source.id,
      sessionId: 'session-michael',
      navStack: [],
        invocationSurface: 'workflow' as const,
    };

    await expect(
      command.execute({ targetAgentId: 'emily', targetWorkflowId: 'chat' }, ctx as any)
    ).rejects.toThrow('persistence failed');

    expect(ctx).toMatchObject({
      agent: source,
      agentId: source.id,
      sessionId: 'session-michael',
      navStack: [],
      history: [{ from: 'michael', content: 'private context' }],
    });
  });
});
