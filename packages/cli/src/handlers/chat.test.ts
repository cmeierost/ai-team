import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICliCommandClient } from '../cli-command-client.js';

const clientApi = vi.hoisted(() => ({
  streamInteraction: vi.fn(),
}));

import { renderChat } from './chat.js';

const client = {
  streamInteraction: clientApi.streamInteraction,
} as unknown as ICliCommandClient;

describe('chat command', () => {
  const originalMediatorLog = process.env.AI_TEAM_MEDIATOR_LOG;
  const originalFrontendFileLog = process.env.AI_TEAM_FRONTEND_FILE_LOG;
  const originalUserName = process.env.AI_TEAM_USER_NAME;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_TEAM_MEDIATOR_LOG = '0';
    process.env.AI_TEAM_FRONTEND_FILE_LOG = '0';
    clientApi.streamInteraction.mockReturnValue(
      (async function* () {
        yield {
          kind: 'started',
          command: 'chat',
          timestamp: new Date().toISOString(),
        };
        yield {
          kind: 'done',
          command: 'chat',
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
        command: 'chat',
        payload: {
          employeeId: 'maya',
          options: { message: 'hello', oneShot: true },
        },
      },
      expect.objectContaining({
        logger: undefined,
        questionInput: expect.any(Function),
        questionConfirm: expect.any(Function),
      })
    );
  });

  it('enables mediator logger when mediatorLog flag is passed', async () => {
    await renderChat(client, 'maya', { message: 'hello', oneShot: true }, true);

    expect(clientApi.streamInteraction).toHaveBeenCalledWith(
      {
        command: 'chat',
        payload: {
          employeeId: 'maya',
          options: { message: 'hello', oneShot: true },
        },
      },
      expect.objectContaining({
        logger: expect.any(Function),
        questionInput: expect.any(Function),
        questionConfirm: expect.any(Function),
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
});
