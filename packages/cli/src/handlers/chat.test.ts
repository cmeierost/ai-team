import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICliCommandClient } from '../cli-command-client.js';

const clientApi = vi.hoisted(() => ({
  streamInteraction: vi.fn(),
  getCommands: vi.fn(),
}));

import { renderChat } from './chat.js';

const client = {
  streamInteraction: clientApi.streamInteraction,
  getCommands: clientApi.getCommands,
} as unknown as ICliCommandClient;

describe('chat command', () => {
  const originalMediatorLog = process.env.AI_TEAM_MEDIATOR_LOG;
  const originalFrontendFileLog = process.env.AI_TEAM_FRONTEND_FILE_LOG;
  const originalUserName = process.env.AI_TEAM_USER_NAME;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_TEAM_MEDIATOR_LOG = '0';
    process.env.AI_TEAM_FRONTEND_FILE_LOG = '0';
    clientApi.getCommands.mockReturnValue([]);
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'started',
          command: 'chat-chat',
          timestamp: new Date().toISOString(),
        };
        yield {
          kind: 'done',
          command: 'chat-chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );
  });

  afterEach(() => {
    if (originalMediatorLog === undefined) {
      delete process.env.AI_TEAM_MEDIATOR_LOG;
    } else {
      process.env.AI_TEAM_MEDIATOR_LOG = originalMediatorLog;
    }
    if (originalFrontendFileLog === undefined) {
      delete process.env.AI_TEAM_FRONTEND_FILE_LOG;
    } else {
      process.env.AI_TEAM_FRONTEND_FILE_LOG = originalFrontendFileLog;
    }
    if (originalUserName === undefined) {
      delete process.env.AI_TEAM_USER_NAME;
    } else {
      process.env.AI_TEAM_USER_NAME = originalUserName;
    }
    vi.restoreAllMocks();
  });

  it('forwards chat request to api client stream', async () => {
    await renderChat(client, 'maya', { message: 'hello', oneShot: true });

    expect(clientApi.streamInteraction).toHaveBeenCalledWith(
      {
        command: 'chat-chat',
        payload: expect.objectContaining({
          agentId: 'maya',
          message: 'hello',
          sessionId: undefined,
          createNewSession: undefined,
        }),
      },
      expect.objectContaining({
        logger: undefined,
        invocationSurface: 'cli',
        calledByHuman: true,
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('enables mediator logger when mediatorLog flag is passed', async () => {
    await renderChat(client, 'maya', { message: 'hello', oneShot: true }, true);

    expect(clientApi.streamInteraction).toHaveBeenCalledWith(
      {
        command: 'chat-chat',
        payload: expect.objectContaining({
          agentId: 'maya',
          message: 'hello',
          sessionId: undefined,
          createNewSession: undefined,
        }),
      },
      expect.objectContaining({
        logger: expect.any(Function),
        invocationSurface: 'cli',
        calledByHuman: true,
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('prints info log events in interactive mode', async () => {
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'log',
          command: 'chat',
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Available commands:',
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await renderChat(client, 'maya', { message: '/help', oneShot: false });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Available commands:'));
  });

  it('renders fs_tree tool events as a concise summary in CLI output', async () => {
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'tool',
          command: 'chat',
          timestamp: new Date().toISOString(),
          toolName: 'fs_tree',
          toolPhase: 'result',
          message: JSON.stringify(
            {
              path: 'src',
              tree: {
                name: 'src',
                isDirectory: true,
                children: [
                  { name: 'components', isDirectory: true, children: [] },
                  { name: 'App.tsx', isDirectory: false },
                ],
              },
            },
            null,
            2
          ),
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await renderChat(client, 'maya', { message: 'show tree', oneShot: true });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('fs_tree'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('src · 2 dirs · 1 files'));
  });

  it('renders generic JSON tool messages as summarized keys instead of raw JSON', async () => {
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'tool',
          command: 'chat',
          timestamp: new Date().toISOString(),
          toolName: 'tool_list',
          toolPhase: 'result',
          message: JSON.stringify({
            type: 'tool_list_result',
            entries: [{ name: 'fs_read' }, { name: 'fs_tree' }],
            count: 2,
          }),
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await renderChat(client, 'maya', { message: 'list tools', oneShot: true });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('tool_list'));
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('json object keys: type, entries, count · entries: 2')
    );
  });

  it('renders com_ask structured payloads as concise answer summaries', async () => {
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'tool',
          command: 'chat',
          timestamp: new Date().toISOString(),
          toolName: 'com_ask',
          toolPhase: 'result',
          toolResult: {
            toolName: 'com_ask',
            outcome: 'result',
            commandResponse: {
              status: 'ok',
              message: 'Question answered',
              data: {
                request: { questionType: 'select' },
                response: { questionType: 'select', answer: 'alex-morgan' },
              },
            },
          },
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await renderChat(client, 'maya', { message: 'ask user', oneShot: true });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('com_ask'));
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('json object keys: request, response')
    );
  });

  it('suppresses raw [tool:com_ask] token JSON when tool event renders successfully', async () => {
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'agent_info',
          command: 'chat',
          timestamp: new Date().toISOString(),
          agentId: 'michael-brown',
          agentName: 'Michael Brown',
          agentRole: 'ceo',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: '[tool:com_ask]\n{ "kind": "select", "message": "Pick one" }',
        };
        yield {
          kind: 'tool',
          command: 'chat',
          timestamp: new Date().toISOString(),
          toolName: 'com_ask',
          toolPhase: 'result',
          toolResult: {
            toolName: 'com_ask',
            outcome: 'result',
            commandResponse: {
              status: 'ok',
              message: 'Question answered',
              data: {
                request: { questionType: 'select' },
                response: { questionType: 'select', answer: 'emily-davis' },
              },
            },
          },
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await renderChat(client, 'michael-brown', { message: 'ask me', oneShot: true });

    expect(stdoutSpy).not.toHaveBeenCalledWith(expect.stringContaining('[tool:com_ask]'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('com_ask'));
  });

  it('renders tool events on a new line after streamed assistant text', async () => {
    process.env.AI_TEAM_USER_NAME = 'Clemens Meier';
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'agent_info',
          command: 'chat',
          timestamp: new Date().toISOString(),
          agentId: 'sarah-lee',
          agentName: 'Sarah Lee',
          agentRole: 'chief-architect',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: 'I can hand this off now.',
        };
        yield {
          kind: 'tool',
          command: 'chat',
          timestamp: new Date().toISOString(),
          toolName: 'com_handoff',
          toolPhase: 'request',
          message: 'com_handoff({"target":"michael-brown"})',
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    await renderChat(client, 'sarah-lee', { message: 'handoff please', oneShot: true });

    const stdoutOutput = stdoutSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
    expect(stdoutOutput).toContain('I can hand this off now.\n');
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('[backend:tool:request]'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('com_handoff'));
  });

  it('prints assistant reply header as Agent (role) → Developer before streamed tokens', async () => {
    process.env.AI_TEAM_USER_NAME = 'Clemens Meier';
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'agent_info',
          command: 'chat',
          timestamp: new Date().toISOString(),
          agentId: 'michael-brown',
          agentName: 'Michael Brown',
          agentRole: 'ceo',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: 'Hello.',
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await renderChat(client, 'michael-brown', { message: 'hello', oneShot: true });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Michael Brown (ceo)'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('→ Clemens Meier: '));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Hello.'));
  });

  it('writes thinking spinner to stderr and leaves streamed token text on stdout', async () => {
    process.env.AI_TEAM_USER_NAME = 'Clemens Meier';
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalStderrIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'agent_info',
          command: 'chat',
          timestamp: new Date().toISOString(),
          agentId: 'michael-brown',
          agentName: 'Michael Brown',
          agentRole: 'ceo',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: 'How can I help?',
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await renderChat(client, 'michael-brown', { message: 'hello', oneShot: false });

      const stderrOutput = stderrSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
      expect(stderrOutput).toMatch(/is thinking/u);
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('How can I help?'));
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stderr, 'isTTY', {
        value: originalStderrIsTTY,
        configurable: true,
      });
    }
  });

  it('renders thinking spinner from backend status phase event', async () => {
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalStderrIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'agent_info',
          command: 'chat',
          timestamp: new Date().toISOString(),
          agentId: 'sarah-lee',
          agentName: 'Sarah Lee',
          agentRole: 'chief-architect',
        };
        yield {
          kind: 'status',
          command: 'chat',
          timestamp: new Date().toISOString(),
          phase: 'thinking',
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await renderChat(client, 'sarah-lee', { message: 'hello', oneShot: false });

      const stderrOutput = stderrSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
      expect(stderrOutput).toContain('Sarah Lee is thinking…');
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stderr, 'isTTY', {
        value: originalStderrIsTTY,
        configurable: true,
      });
    }
  });

  it('emits in-place spinner control sequences when thinking indicator is active', async () => {
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalStderrIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'agent_info',
          command: 'chat',
          timestamp: new Date().toISOString(),
          agentId: 'clara-bishop',
          agentName: 'Clara Bishop',
          agentRole: 'frontend-quality-engineer',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: 'Hello there',
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await renderChat(client, 'clara-bishop', { message: 'hello', oneShot: false });

      const stderrOutput = stderrSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
      expect(stderrOutput).toContain('\r');
      expect(stderrOutput).toContain('\x1b[2K');
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stderr, 'isTTY', {
        value: originalStderrIsTTY,
        configurable: true,
      });
    }
  });

  it('capitalizes fallback agent name from lowercase alias in thinking indicator', async () => {
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalStderrIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: 'Hi',
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await renderChat(client, 'clara', { message: 'hello', oneShot: false });

      const stderrOutput = stderrSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
      expect(stderrOutput).toContain('Clara is thinking…');
      expect(stderrOutput).not.toContain('clara is thinking…');
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stderr, 'isTTY', {
        value: originalStderrIsTTY,
        configurable: true,
      });
    }
  });

  it('renders thinking indicator again after tool result in the same turn', async () => {
    process.env.AI_TEAM_USER_NAME = 'Clemens Meier';
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalStderrIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });

    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'agent_info',
          command: 'chat',
          timestamp: new Date().toISOString(),
          agentId: 'clara-bishop',
          agentName: 'Clara Bishop',
          agentRole: 'frontend-quality-engineer',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: 'Sure — checking that now.',
        };
        yield {
          kind: 'tool',
          command: 'chat',
          timestamp: new Date().toISOString(),
          toolName: 'skill_load',
          toolPhase: 'result',
          message: 'Loaded session skill.',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: 'Done.',
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await renderChat(client, 'clara-bishop', { message: 'hello', oneShot: false });

      const thinkingWrites = stderrSpy.mock.calls.filter((call) =>
        String(call[0] ?? '').includes('Clara Bishop is thinking…')
      );
      expect(thinkingWrites.length).toBeGreaterThanOrEqual(1);
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      Object.defineProperty(process.stderr, 'isTTY', {
        value: originalStderrIsTTY,
        configurable: true,
      });
    }
  });

  it('groups thought token chunks into a single distinct thinking line', async () => {
    process.env.AI_TEAM_USER_NAME = 'Clemens Meier';
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'agent_info',
          command: 'chat',
          timestamp: new Date().toISOString(),
          agentId: 'clara-bishop',
          agentName: 'Clara Bishop',
          agentRole: 'frontend-quality-engineer',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: '💭 The user ',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: '💭 asked about rendering.',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: "Let's fix it.",
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await renderChat(client, 'clara-bishop', { message: 'hello', oneShot: true });

    const output = stdoutSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
    expect(output).toContain('💭 thinking: ');
    expect(output).toContain('The user asked about rendering.');
    expect(output).toContain('Clara Bishop (frontend-quality-engineer)');
    expect(output).toContain("Let's fix it.");

    const thoughtLabelCount = (output.match(/💭 thinking:/g) ?? []).length;
    expect(thoughtLabelCount).toBe(1);
  });

  it('normalizes repeated 💭 markers inside one thought token chunk', async () => {
    process.env.AI_TEAM_USER_NAME = 'Clemens Meier';
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'agent_info',
          command: 'chat',
          timestamp: new Date().toISOString(),
          agentId: 'clara-bishop',
          agentName: 'Clara Bishop',
          agentRole: 'frontend-quality-engineer',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: '💭 The user💭  wants me💭  to help.',
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await renderChat(client, 'clara-bishop', { message: 'hello', oneShot: true });

    const output = stdoutSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
    expect(output).toContain('💭 thinking: ');
    expect(output).toContain('The user wants me to help.');
    expect(output).not.toContain('The user💭');
  });

  it('preserves spacing between thinking chunks when subsequent chunk starts with a leading space', async () => {
    process.env.AI_TEAM_USER_NAME = 'Clemens Meier';
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'agent_info',
          command: 'chat',
          timestamp: new Date().toISOString(),
          agentId: 'sarah-lee',
          agentName: 'Sarah Lee',
          agentRole: 'chief-architect',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: '💭 The user',
        };
        yield {
          kind: 'token',
          command: 'chat',
          timestamp: new Date().toISOString(),
          text: '💭 has now said hello.',
        };
        yield {
          kind: 'done',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
      })()
    );

    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await renderChat(client, 'sarah-lee', { message: 'hello', oneShot: true });

    const output = stdoutSpy.mock.calls.map((call) => String(call[0] ?? '')).join('');
    expect(output).toContain('The user has now said hello.');
    expect(output).not.toContain('The userhas');
  });
});
