import { describe, expect, it, vi } from 'vitest';
import type { ITerminal } from '@ai-team/core';
import type { StreamEvent } from '@ai-team/api-contracts';
import type { ICliCommandClient } from '../cli-command-client.js';
import { renderChat } from './chat.js';
import { InquirerQuestionService } from './question-responders.js';

class FakeTerminal implements ITerminal {
  columns = 100;
  rows = 30;
  writes: string[] = [];
  private onInput?: (data: string) => void;
  private onResize?: () => void;

  write(data: string): void {
    this.writes.push(data);
  }
  hideCursor(): void {}
  showCursor(): void {}
  start(onInput: (data: string) => void, onResize: () => void): void {
    this.onInput = onInput;
    this.onResize = onResize;
  }
  stop(): void {}

  input(data: string): void {
    this.onInput?.(data);
  }
}

function clientWith(events: StreamEvent<'chat'>[]): ICliCommandClient {
  return {
    getCommands: () => [],
    streamInteraction: async function* () {
      for (const event of events) {
        yield event;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    },
  };
}

const timestamp = '2026-07-23T10:00:00.000Z';

describe('new chat TUI projection', () => {
  it('renders user input and streamed agent tokens from service events', async () => {
    const terminal = new FakeTerminal();
    const client = clientWith([
      {
        command: 'chat',
        kind: 'agent_info',
        timestamp,
        agentId: 'michael-brown',
        agentName: 'Michael Brown',
        developerName: 'Clemens',
        llmModel: 'gpt-5.2',
        avatarColor: 'hsl(205, 70%, 60%)',
      },
      { command: 'chat', kind: 'token', timestamp, text: 'Hello from Michael.' },
      { command: 'chat', kind: 'done', timestamp },
    ]);

    await renderChat(
      client,
      'michael-brown',
      { oneShot: true, message: 'Hello' },
      false,
      undefined,
      'chat',
      {
        agentId: 'michael-brown',
        agentName: 'Michael Brown',
        sessionId: 'session-1234567890',
      },
      { terminal }
    );

    const output = terminal.writes.join('');
    expect(output).toContain('Clemens');
    expect(output).not.toContain('You:');
    expect(output).toContain('Hello');
    expect(output).toContain('Hello from Michael.');
    expect(output).toContain('\x1b[38;2;82;165;224m');
    expect(output).toContain('Michael Brown');
    expect(output).toContain('(gpt-5.2) - session-1234567890');
  });

  it('uses the selected agent id until agent_info supplies richer display data', async () => {
    const terminal = new FakeTerminal();
    const client = clientWith([
      { command: 'chat', kind: 'token', timestamp, text: 'Early greeting.' },
      { command: 'chat', kind: 'done', timestamp },
    ]);

    await renderChat(
      client,
      'michael-brown',
      { oneShot: true, message: 'Hello' },
      false,
      undefined,
      'chat',
      { agentId: 'michael-brown' },
      { terminal }
    );

    const output = terminal.writes.join('');
    expect(output).toContain('Michael Brown');
    expect(output).toContain('Early greeting.');
  });

  it('renders a visible thinking indicator from service status events', async () => {
    const terminal = new FakeTerminal();
    const client = clientWith([
      { command: 'chat', kind: 'status', timestamp, phase: 'thinking' },
      { command: 'chat', kind: 'done', timestamp },
    ]);

    await renderChat(
      client,
      'michael-brown',
      { oneShot: true, message: 'Hello' },
      false,
      undefined,
      'chat',
      { agentId: 'michael-brown' },
      { terminal }
    );

    expect(terminal.writes.join('')).toContain('Michael Brown is thinking…');
  });

  it('renders a streamed turn error before ending the chat turn', async () => {
    const terminal = new FakeTerminal();
    const client = clientWith([
      { command: 'chat', kind: 'error', timestamp, message: 'Target agent is unavailable.' },
    ]);

    await renderChat(
      client,
      'michael-brown',
      { oneShot: true, message: 'Please hand this off.' },
      false,
      undefined,
      'chat',
      { agentId: 'michael-brown' },
      { terminal }
    );

    const output = terminal.writes.join('');
    expect(output).toContain('Target agent is unavailable.');
    expect(output).toContain('Error');
    expect(output).toContain('\x1b[48;2;');
  });

  it('renders an LLM failure reported through a status event', async () => {
    const terminal = new FakeTerminal();
    const client = clientWith([
      {
        command: 'chat',
        kind: 'status',
        timestamp,
        phase: 'error',
        message: 'The target model timed out.',
      },
      { command: 'chat', kind: 'done', timestamp },
    ]);

    await renderChat(
      client,
      'michael-brown',
      { oneShot: true, message: 'Please hand this off.' },
      false,
      undefined,
      'chat',
      { agentId: 'michael-brown' },
      { terminal }
    );

    const output = terminal.writes.join('');
    expect(output).toContain('The target model timed out.');
    expect(output).toContain('Error');
    expect(output).toContain('\x1b[48;2;');
  });

  it('sends slash commands unchanged through the shared chat interaction', async () => {
    const terminal = new FakeTerminal();
    const requests: Array<{ command: string; payload?: unknown }> = [];
    const client: ICliCommandClient = {
      getCommands: () => [],
      streamInteraction: async function* (request) {
        requests.push(request);
        yield { command: 'chat', kind: 'done', timestamp };
      },
    };

    await renderChat(
      client,
      'michael-brown',
      { oneShot: true, message: '/help' },
      false,
      undefined,
      'chat-chat',
      {
        agentId: 'michael-brown',
        __slashSuggestions: [
          {
            key: 'help',
            description: 'Show help',
            availableIn: { cliChat: true },
          },
        ],
      },
      { terminal }
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      command: 'chat-chat',
      payload: { agentId: 'michael-brown', message: '/help' },
    });
    expect(requests[0]?.payload).not.toHaveProperty('__slashSuggestions');
  });

  it('keeps slash invocations as developer lines and renders results as standalone transcript entries', async () => {
    const terminal = new FakeTerminal();
    const client = clientWith([
      {
        command: 'chat',
        kind: 'agent_info',
        timestamp,
        agentName: 'Michael Brown',
        developerName: 'Clemens',
      },
      {
        command: 'chat',
        kind: 'tool',
        timestamp,
        toolName: 'slash:help',
        toolPhase: 'result',
        toolResult: {
          toolName: 'slash:help',
          outcome: 'result',
          request: { rawInput: '/help' },
          commandResponse: {
            status: 'ok',
            message: 'Available in-chat commands.',
          },
        },
      },
      { command: 'chat', kind: 'done', timestamp },
    ]);

    await renderChat(
      client,
      'michael-brown',
      { oneShot: true, message: '/help' },
      false,
      undefined,
      'chat',
      undefined,
      { terminal }
    );

    const output = terminal.writes.join('');
    expect(output).toContain('Clemens');
    expect(output).toContain('/help');
    expect(output).toContain('Available in-chat commands.');
    expect(output).not.toContain('slash:help [result]');
  });

  it('presents com_ask inside the composer and appends one compact completed card', async () => {
    const terminal = new FakeTerminal();
    const fallbackPrompt = vi.fn(async () => {
      throw new Error('Inquirer should not run while the chat TUI is attached');
    });
    const questionService = new InquirerQuestionService(fallbackPrompt);
    const client: ICliCommandClient = {
      getCommands: () => [],
      streamInteraction: async function* () {
        const request = {
          message: 'Choose an owner',
          choices: [
            { name: 'Michael Brown', value: 'michael-brown' },
            { name: 'Sarah Lee', value: 'sarah-lee', recommended: true },
          ],
          default: 'sarah-lee',
        };
        yield {
          command: 'chat',
          kind: 'tool',
          timestamp,
          toolName: 'com_ask',
          toolCallId: 'ask-1',
          toolPhase: 'start',
          toolResult: {
            toolName: 'com_ask',
            outcome: 'start',
            request: { kind: 'select', ...request },
          },
        } as any;
        const answer = await questionService.select(request);
        yield {
          command: 'chat',
          kind: 'tool',
          timestamp,
          toolName: 'com_ask',
          toolCallId: 'ask-1',
          toolPhase: 'result',
          toolResult: {
            toolName: 'com_ask',
            outcome: 'result',
            request: { kind: 'select', ...request },
            commandResponse: {
              status: 'ok',
              data: { type: 'com_ask_result', kind: 'select', answer },
            },
          },
        } as any;
        yield { command: 'chat', kind: 'done', timestamp };
      },
    };

    const pending = renderChat(
      client,
      'michael-brown',
      { oneShot: true, message: 'Who should own this?' },
      false,
      undefined,
      'chat',
      undefined,
      { terminal, questionService }
    );
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (terminal.writes.join('').includes('Choose an owner')) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    terminal.input('\r');
    await pending;

    const output = terminal.writes.join('');
    expect(fallbackPrompt).not.toHaveBeenCalled();
    expect(output).toContain('Choose an owner');
    expect(output).toContain('Answer:');
    expect(output).toContain('Sarah Lee');
    expect(output).not.toContain('▼ com_ask');
  });

  it('projects startup agent and model events through the TUI before the turn', async () => {
    const terminal = new FakeTerminal();
    const commands: string[] = [];
    const client: ICliCommandClient = {
      getCommands: () => [],
      streamInteraction: async function* (request) {
        commands.push(request.command);
        if (request.command === 'chat-chat-startup') {
          yield {
            command: request.command,
            kind: 'agent_info',
            timestamp,
            agentId: 'michael-brown',
            agentName: 'Michael Brown',
            developerName: 'Clemens Meier',
            llmModel: 'gpt-5.2',
          };
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        yield { command: request.command, kind: 'done', timestamp };
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    };

    await renderChat(
      client,
      'michael-brown',
      { oneShot: false, message: 'Hello', createNewSession: false },
      false,
      undefined,
      'chat-chat',
      {
        agentId: 'michael-brown',
        agentName: 'Michael Brown',
        sessionId: 'session-1',
      },
      { terminal }
    );

    expect(commands).toEqual(['chat-chat-startup', 'chat-chat']);
    expect(terminal.writes.join('')).toContain('(gpt-5.2) - session-1');
  });

  it('runs startup for bare chat so the service can choose the CEO and session', async () => {
    const terminal = new FakeTerminal();
    const requests: Array<{ command: string; payload?: Record<string, unknown> }> = [];
    const client: ICliCommandClient = {
      getCommands: () => [],
      streamInteraction: async function* (request) {
        requests.push(request as { command: string; payload?: Record<string, unknown> });
        if (request.command === 'chat-chat-startup') {
          yield {
            command: request.command,
            kind: 'agent_info',
            timestamp,
            agentId: 'michael-brown',
            agentName: 'Michael Brown',
            llmModel: 'best-chat',
          };
          yield {
            command: request.command,
            kind: 'workspace_info',
            timestamp,
            workspace: 'C:\\Projects\\ai-team',
            gitBranch: 'main',
          };
          yield {
            command: request.command,
            kind: 'session_switched',
            timestamp,
            agentId: 'michael-brown',
            sessionId: 'session-new-ceo',
          };
        }
        yield { command: request.command, kind: 'done', timestamp };
      },
    };

    await renderChat(
      client,
      undefined,
      { oneShot: false, message: 'Hello', createNewSession: false },
      false,
      undefined,
      'chat-chat',
      { createNewSession: false },
      { terminal }
    );

    expect(requests.map((request) => request.command)).toEqual(['chat-chat-startup', 'chat-chat']);
    expect(requests[0]?.payload).toMatchObject({
      employeeId: undefined,
      options: { createNewSession: false, introduction: true },
    });
    expect(requests[1]?.payload).toMatchObject({
      sessionId: 'session-new-ceo',
      message: 'Hello',
    });
    expect(terminal.writes.join('')).toContain('main');
    expect(terminal.writes.join('')).toContain('session-new-ceo');
  });

  it('uses the workflow introduction and injects workflow context into the first turn', async () => {
    const terminal = new FakeTerminal();
    const requests: Array<{ command: string; payload?: Record<string, any> }> = [];
    const client: ICliCommandClient = {
      getCommands: () => [],
      streamInteraction: async function* (request) {
        requests.push(request as { command: string; payload?: Record<string, any> });
        if (request.command === 'chat-chat-startup') {
          yield {
            command: request.command,
            kind: 'session_switched',
            timestamp,
            agentId: 'elena-rodriguez',
            sessionId: 'session-onboarding',
          };
        }
        yield { command: request.command, kind: 'done', timestamp };
      },
    };

    await renderChat(
      client,
      'elena-rodriguez',
      {
        message: 'We serve small teams.',
        createNewSession: true,
        workflowMode: true,
        workflowSystemPrompt: 'Ask one focused business question at a time.',
        workflowExitWords: ['done'],
        workflowToolAllowlist: ['com_ask'],
        suppressAutoIntroduction: true,
        introductionText: "Hi Clemens, let's define the business.",
      },
      false,
      undefined,
      'chat-chat',
      { agentId: 'elena-rodriguez' },
      { terminal }
    );

    expect(requests[0]).toMatchObject({
      command: 'chat-chat-startup',
      payload: {
        options: {
          introduction: true,
          introductionText: "Hi Clemens, let's define the business.",
          workflowMode: true,
          workflowExitWords: ['done'],
        },
      },
    });
    expect(requests[1]?.payload).toMatchObject({
      message: 'We serve small teams.',
      workflowSystemPrompt: 'Ask one focused business question at a time.',
      workflowToolAllowlist: ['com_ask'],
    });
  });

  it('adopts a newly persisted startup session before the first turn', async () => {
    const terminal = new FakeTerminal();
    const requests: Array<{ command: string; payload?: Record<string, unknown> }> = [];
    const client: ICliCommandClient = {
      getCommands: () => [],
      streamInteraction: async function* (request) {
        requests.push(request as { command: string; payload?: Record<string, unknown> });
        if (request.command === 'chat-chat-startup') {
          yield {
            command: request.command,
            kind: 'agent_info',
            timestamp,
            agentId: 'sarah-lee',
            agentName: 'Sarah Lee',
            llmModel: 'best-chat',
          };
          await new Promise<void>((resolve) => setImmediate(resolve));
          yield {
            command: request.command,
            kind: 'workspace_info',
            timestamp,
            workspace: 'C:\\Projects\\ai-team',
            gitBranch: 'feature/tui',
          };
          await new Promise<void>((resolve) => setImmediate(resolve));
          yield {
            command: request.command,
            kind: 'session_switched',
            timestamp,
            agentId: 'sarah-lee',
            sessionId: 'session-new-sarah',
          };
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        yield { command: request.command, kind: 'done', timestamp };
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    };

    await renderChat(
      client,
      'sarah-lee',
      { oneShot: false, message: 'Hello' },
      false,
      undefined,
      'chat-chat',
      {
        agentId: 'sarah-lee',
        agentName: 'Sarah Lee',
      },
      { terminal }
    );

    expect(requests[1]?.payload).toMatchObject({
      agentId: 'sarah-lee',
      sessionId: 'session-new-sarah',
      message: 'Hello',
    });
    const output = terminal.writes.join('');
    expect(output).toContain('C:\\Projects\\ai-team - feature/tui -');
    expect(output).toContain('Sarah Lee');
    expect(output).toContain('(best-chat) - session-new-sarah');
  });

  it('keeps both sides of a handoff in one transcript', async () => {
    const terminal = new FakeTerminal();
    const client = clientWith([
      {
        command: 'chat',
        kind: 'agent_info',
        timestamp,
        agentId: 'michael-brown',
        agentName: 'Michael Brown',
      },
      { command: 'chat', kind: 'token', timestamp, text: 'I will hand this over.' },
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        fromAgentId: 'michael-brown',
        fromAgentName: 'Michael Brown',
        toAgentId: 'sarah-lee',
        toAgentName: 'Sarah Lee',
        briefingContent: 'Keep the service event-driven.',
      },
      {
        command: 'chat',
        kind: 'subworkflow_start',
        timestamp,
        agentId: 'sarah-lee',
        agentName: 'Sarah Lee',
      },
      { command: 'chat', kind: 'token', timestamp, text: 'I have the briefing.' },
      {
        command: 'chat',
        kind: 'subworkflow_end',
        timestamp,
        agentId: 'sarah-lee',
      },
      { command: 'chat', kind: 'done', timestamp },
    ]);

    await renderChat(
      client,
      'michael-brown',
      { oneShot: true, message: 'Review this' },
      false,
      undefined,
      'chat',
      undefined,
      { terminal }
    );

    const output = terminal.writes.join('');
    expect(output).toContain('I will hand this over.');
    expect(output).toContain('Keep the service event-driven.');
    expect(output).toContain('I have the briefing.');
  });

  it('renders a streaming handoff briefing before the target agent starts thinking', async () => {
    const terminal = new FakeTerminal();
    const client = clientWith([
      {
        command: 'chat',
        kind: 'agent_info',
        timestamp,
        agentId: 'emily-davis',
        agentName: 'Emily Davis',
      },
      { command: 'chat', kind: 'status', timestamp, phase: 'thinking' },
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        handoffId: 'handoff-1',
        handoffPhase: 'start',
        fromAgentId: 'emily-davis',
        fromAgentName: 'Emily Davis',
        toAgentId: 'michael-brown',
        toAgentName: 'Michael Brown',
      },
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        handoffId: 'handoff-1',
        handoffPhase: 'delta',
        fromAgentId: 'emily-davis',
        toAgentId: 'michael-brown',
        delta: 'Clemens wants Michael to take over.',
      },
      {
        command: 'chat',
        kind: 'handoff',
        timestamp,
        handoffId: 'handoff-1',
        handoffPhase: 'complete',
        fromAgentId: 'emily-davis',
        fromAgentName: 'Emily Davis',
        toAgentId: 'michael-brown',
        toAgentName: 'Michael Brown',
        briefingContent: 'Clemens wants Michael to take over.',
      },
      {
        command: 'chat',
        kind: 'agent_info',
        timestamp,
        agentId: 'michael-brown',
        agentName: 'Michael Brown',
      },
      { command: 'chat', kind: 'status', timestamp, phase: 'thinking' },
      { command: 'chat', kind: 'done', timestamp },
    ] as any);

    await renderChat(
      client,
      'emily-davis',
      { oneShot: true, message: 'Let me talk to Michael' },
      false,
      undefined,
      'chat',
      undefined,
      { terminal }
    );

    const output = terminal.writes.join('');
    const briefingPosition = output.indexOf('Clemens wants Michael to take over.');
    const targetThinkingPosition = output.indexOf('Michael Brown is thinking…');
    expect(briefingPosition).toBeGreaterThanOrEqual(0);
    expect(targetThinkingPosition).toBeGreaterThan(briefingPosition);
  });

  it('paints a handoff delta before the handoff command completes', async () => {
    const terminal = new FakeTerminal();
    let releaseComplete!: () => void;
    let markDeltaYielded!: () => void;
    const completeGate = new Promise<void>((resolve) => {
      releaseComplete = resolve;
    });
    const deltaYielded = new Promise<void>((resolve) => {
      markDeltaYielded = resolve;
    });
    const client: ICliCommandClient = {
      getCommands: () => [],
      streamInteraction: async function* () {
        yield {
          command: 'chat',
          kind: 'handoff',
          timestamp,
          handoffId: 'handoff-streaming-return',
          handoffPhase: 'start',
          fromAgentId: 'sarah-lee',
          fromAgentName: 'Sarah Lee',
          toAgentId: 'michael-brown',
          toAgentName: 'Michael Brown',
        } as any;
        yield {
          command: 'chat',
          kind: 'handoff',
          timestamp,
          handoffId: 'handoff-streaming-return',
          handoffPhase: 'delta',
          fromAgentId: 'sarah-lee',
          toAgentId: 'michael-brown',
          delta: 'The architectural priorities are now clear.',
        } as any;
        markDeltaYielded();
        await completeGate;
        yield {
          command: 'chat',
          kind: 'handoff',
          timestamp,
          handoffId: 'handoff-streaming-return',
          handoffPhase: 'complete',
          fromAgentId: 'sarah-lee',
          fromAgentName: 'Sarah Lee',
          toAgentId: 'michael-brown',
          toAgentName: 'Michael Brown',
          briefingContent: 'The architectural priorities are now clear.',
        } as any;
        yield { command: 'chat', kind: 'done', timestamp } as any;
      },
    };

    const renderPromise = renderChat(
      client,
      'sarah-lee',
      { oneShot: true, message: '/return' },
      false,
      undefined,
      'chat',
      undefined,
      { terminal }
    );

    await deltaYielded;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(terminal.writes.join('')).toContain('The architectural priorities are now clear.');

    releaseComplete();
    await renderPromise;
  });

  it('sends the next turn to the service-emitted handoff agent and session', async () => {
    const terminal = new FakeTerminal();
    const requests: Array<{ command: string; payload?: Record<string, unknown> }> = [];
    const client: ICliCommandClient = {
      getCommands: () => [],
      streamInteraction: async function* (request) {
        requests.push(request as any);
        if (request.command === 'chat-chat-startup') {
          yield {
            command: request.command,
            kind: 'agent_info',
            timestamp,
            agentId: 'michael-brown',
            agentName: 'Michael Brown',
          };
        } else if (requests.filter((entry) => entry.command === 'chat-chat').length === 1) {
          yield {
            command: request.command,
            kind: 'handoff',
            timestamp,
            fromAgentId: 'michael-brown',
            fromAgentName: 'Michael Brown',
            fromSessionId: 'session-michael',
            toAgentId: 'emily-davis',
            toAgentName: 'Emily Davis',
            toLlmModel: 'best-chat',
            toSessionId: 'session-emily',
            briefingContent: 'Emily has the context.',
          };
          yield {
            command: request.command,
            kind: 'session_switched',
            timestamp,
            agentId: 'emily-davis',
            sessionId: 'session-emily',
          } as any;
          yield {
            command: request.command,
            kind: 'agent_info',
            timestamp,
            agentId: 'emily-davis',
            agentName: 'Emily Davis',
            llmModel: 'best-chat',
          };
        }
        yield { command: request.command, kind: 'done', timestamp };
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    };

    const pending = renderChat(
      client,
      'michael-brown',
      { oneShot: false, sessionId: 'session-michael' },
      false,
      undefined,
      'chat-chat',
      {
        agentId: 'michael-brown',
        sessionId: 'session-michael',
      },
      { terminal }
    );

    const enter = async (text: string) => {
      for (let attempt = 0; attempt < 30; attempt++) {
        if (terminal.writes.join('').includes('>')) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      for (const char of text) terminal.input(char);
      terminal.input('\r');
      await new Promise<void>((resolve) => setImmediate(resolve));
    };

    await enter('/handoff emily');
    for (let attempt = 0; attempt < 30; attempt++) {
      if (requests.filter((entry) => entry.command === 'chat-chat').length >= 1) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await enter('who am I talking to?');
    for (let attempt = 0; attempt < 30; attempt++) {
      if (requests.filter((entry) => entry.command === 'chat-chat').length >= 2) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    await enter('/exit');
    await pending;

    const turns = requests.filter((entry) => entry.command === 'chat-chat');
    expect(turns[1]?.payload).toMatchObject({
      agentId: 'emily-davis',
      sessionId: 'session-emily',
      message: 'who am I talking to?',
    });
    expect(terminal.writes.join('')).toContain('(best-chat) - session-emily');
  });

  it('prints commands for resuming the current or latest session when exiting', async () => {
    const terminal = new FakeTerminal();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const pending = renderChat(
      clientWith([
        {
          command: 'chat-chat-startup',
          kind: 'agent_info',
          timestamp,
          agentId: 'michael-brown',
          agentName: 'Michael Brown',
        },
        { command: 'chat-chat-startup', kind: 'done', timestamp },
      ]),
      'michael-brown',
      { oneShot: false, sessionId: 'session-2026-07-23-abc123' },
      false,
      async () => 'ai-team',
      'chat-chat',
      {
        agentId: 'michael-brown',
        sessionId: 'session-2026-07-23-abc123',
      },
      { terminal }
    );

    for (let attempt = 0; attempt < 20; attempt++) {
      if (terminal.writes.join('').includes('>')) break;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(terminal.writes.join('')).toContain('>');
    for (const char of '/exit') terminal.input(char);
    terminal.input('\r');
    await pending;

    const output = stdout.mock.calls.map(([text]) => String(text)).join('');
    expect(output).toContain(
      'See you next time — the ai-team team will be here when you need us 👋'
    );
    expect(output).toContain('ait chat session-2026-07-23-abc123');
    expect(output).toContain('Return to your last session: ait chat');
    stdout.mockRestore();
  });
});
