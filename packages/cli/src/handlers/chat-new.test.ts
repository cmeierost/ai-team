import { describe, expect, it, vi } from 'vitest';
import type { ITerminal } from '@ai-team/core';
import type { StreamEvent } from '@ai-team/api-contracts';
import type { ICliCommandClient } from '../cli-command-client.js';
import { renderChat } from './chat-new.js';

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
    expect(output).toContain('(gpt-5.2) - session id: session-1234567890');
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
      { oneShot: false, message: 'Hello' },
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
    expect(terminal.writes.join('')).toContain(
      '(gpt-5.2) - session id: session-1'
    );
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
