import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ICommandClient } from '@ai-team/api-client';

const clientApi = vi.hoisted(() => ({
  stream: vi.fn(),
}));

import { chatCommand } from './chat.js';

const client = {
  stream: clientApi.stream,
} as unknown as ICommandClient;

describe('chat command', () => {
  const originalMediatorLog = process.env.AI_TEAM_MEDIATOR_LOG;
  const originalFrontendFileLog = process.env.AI_TEAM_FRONTEND_FILE_LOG;
  const originalUserName = process.env.AI_TEAM_USER_NAME;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_TEAM_MEDIATOR_LOG = '0';
    process.env.AI_TEAM_FRONTEND_FILE_LOG = '0';
    clientApi.stream.mockReturnValue(
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
    await chatCommand(client, 'maya', { message: 'hello', oneShot: true });

    expect(clientApi.stream).toHaveBeenCalledWith(
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
    await chatCommand(client, 'maya', { message: 'hello', oneShot: true }, true);

    expect(clientApi.stream).toHaveBeenCalledWith(
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
    clientApi.stream.mockReturnValue(
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

    await chatCommand(client, 'maya', { message: '/help', oneShot: false });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Available commands:'));
  });

  it('renders fs_tree tool events as a concise summary in CLI output', async () => {
    clientApi.stream.mockReturnValue(
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

    await chatCommand(client, 'maya', { message: 'show tree', oneShot: true });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('fs_tree'));
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('src · 2 dirs · 1 files'));
  });

  it('renders generic JSON tool messages as summarized keys instead of raw JSON', async () => {
    clientApi.stream.mockReturnValue(
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

    await chatCommand(client, 'maya', { message: 'list tools', oneShot: true });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('tool_list'));
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('json object keys: type, entries, count · entries: 2')
    );
  });

  it('renders com_ask structured payloads as concise answer summaries', async () => {
    clientApi.stream.mockReturnValue(
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
            result: {
              request: { questionType: 'select' },
              response: { questionType: 'select', answer: 'alex-morgan' },
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

    await chatCommand(client, 'maya', { message: 'ask user', oneShot: true });

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('com_ask'));
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('json object keys: request, response')
    );
  });

  it('prints assistant reply header as Agent (role) → Developer before streamed tokens', async () => {
    process.env.AI_TEAM_USER_NAME = 'Clemens Meier';
    clientApi.stream.mockReturnValue(
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

    await chatCommand(client, 'michael-brown', { message: 'hello', oneShot: true });

    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Michael Brown (ceo)'));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('→ Clemens Meier: '));
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('Hello.'));
  });
});
