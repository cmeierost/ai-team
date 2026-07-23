import { describe, expect, it, vi } from 'vitest';
import { HandoffCommand } from './handoff.command.js';

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
    getAgentAsync: vi.fn(async (id: string) =>
      id === source.id ? source : TARGET
    ),
  } as any;
  const commandDispatcher = {
    dispatch: vi.fn(async () => ({
      status: 'ok',
      message: 'answered',
      data: { type: 'com_ask_result', answer: askAnswer },
    })),
  } as any;
  return {
    command: new HandoffCommand(
      handoffSubWorkflow,
      emitService,
      agentManager,
      commandDispatcher
    ),
    handoffSubWorkflow,
    commandDispatcher,
  };
}

describe('HandoffCommand delegation approval', () => {
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

  it('asks through com_ask before an agent hands off to an unconfigured target', async () => {
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

    expect(result.status).toBe('cancelled');
    expect(commandDispatcher.dispatch).toHaveBeenCalledWith(
      'com-ask',
      expect.objectContaining({ kind: 'confirm', defaultBoolean: false }),
      expect.anything()
    );
    expect(handoffSubWorkflow.executeAsync).not.toHaveBeenCalled();
  });

  it('allows a configured agent handoff target without asking', async () => {
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
    expect(handoffSubWorkflow.executeAsync).toHaveBeenCalledOnce();
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
        invocationSurface: 'tool',
        calledByHuman: false,
      }
    );

    expect(result.status).toBe('ok');
    expect(commandDispatcher.dispatch).toHaveBeenCalledOnce();
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
});
