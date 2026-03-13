import { beforeEach, describe, expect, it, vi } from 'vitest';

const listApi = vi.hoisted(() => ({
  listEmployeesCommand: vi.fn(),
  resolveEmployeesCommand: vi.fn(),
  createCommand: vi.fn(),
  chatCommand: vi.fn(),
  hireCommand: vi.fn(),
  fireCommand: vi.fn(),
  initCommand: vi.fn(),
  hhRefreshCommand: vi.fn(),
  providerConfigureCommand: vi.fn(),
  providerAddCommand: vi.fn(),
  providerSetCommand: vi.fn(),
  providerModelsCommand: vi.fn(),
  providerModelsRefreshCommand: vi.fn(),
  testConnectionCommand: vi.fn(),
}));

vi.mock('./commands/list.js', () => ({
  listEmployeesCommand: listApi.listEmployeesCommand,
}));

vi.mock('./commands/info.js', () => ({
  resolveEmployeesCommand: listApi.resolveEmployeesCommand,
}));

vi.mock('./commands/create.js', () => ({
  createCommand: listApi.createCommand,
}));

vi.mock('./commands/chat/index.js', () => ({
  chatCommand: listApi.chatCommand,
}));

vi.mock('./commands/hire.js', () => ({
  hireCommand: listApi.hireCommand,
}));

vi.mock('./commands/fire.js', () => ({
  fireCommand: listApi.fireCommand,
}));

vi.mock('./commands/init.js', () => ({
  initCommand: listApi.initCommand,
}));

vi.mock('./commands/hh.js', () => ({
  hhRefreshCommand: listApi.hhRefreshCommand,
}));

vi.mock('./commands/provider.js', () => ({
  providerConfigureCommand: listApi.providerConfigureCommand,
  providerAddCommand: listApi.providerAddCommand,
  providerSetCommand: listApi.providerSetCommand,
}));

vi.mock('./commands/models.js', () => ({
  providerModelsCommand: listApi.providerModelsCommand,
  providerModelsRefreshCommand: listApi.providerModelsRefreshCommand,
}));

vi.mock('./commands/test-connection.js', () => ({
  testConnectionCommand: listApi.testConnectionCommand,
}));

import { createAiTeamService } from './index.js';

describe('createAiTeamService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listApi.listEmployeesCommand.mockResolvedValue([]);
    listApi.resolveEmployeesCommand.mockResolvedValue([]);
    listApi.createCommand.mockResolvedValue(undefined);
    listApi.chatCommand.mockResolvedValue(undefined);
    listApi.hireCommand.mockResolvedValue(undefined);
    listApi.fireCommand.mockResolvedValue(undefined);
    listApi.initCommand.mockResolvedValue(undefined);
    listApi.hhRefreshCommand.mockResolvedValue(undefined);
    listApi.providerConfigureCommand.mockResolvedValue(undefined);
    listApi.providerAddCommand.mockResolvedValue(undefined);
    listApi.providerSetCommand.mockResolvedValue(undefined);
    listApi.providerModelsCommand.mockResolvedValue(undefined);
    listApi.providerModelsRefreshCommand.mockResolvedValue(undefined);
    listApi.testConnectionCommand.mockResolvedValue(undefined);
  });

  it('delegates list operation to command module', async () => {
    listApi.listEmployeesCommand.mockResolvedValue([{ name: 'Maya', role: 'engineer' }]);

    const service = createAiTeamService('c:/workspace');
    const request = { role: 'engineer' };
    const result = await service.listEmployees(request);

    expect(listApi.listEmployeesCommand).toHaveBeenCalledWith('c:/workspace', request);
    expect(result).toEqual([{ name: 'Maya', role: 'engineer' }]);
  });

  it('delegates mutating and provider operations to command modules', async () => {
    const service = createAiTeamService('c:/workspace');

    await service.invoke({ command: 'resolveEmployees', payload: { query: 'maya' } });
    const events = [] as unknown[];
    for await (const event of service.stream({ command: 'listEmployees', payload: {} })) {
      events.push(event);
    }
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(listApi.resolveEmployeesCommand).toHaveBeenCalledWith('c:/workspace', 'maya');

    await service.create('agent', { name: 'Maya' });
    await service.chat('maya', { message: 'hello' });
    await service.hire({ name: 'Maya', role: 'engineer' });
    await service.fire('maya', { force: true });
    await service.init({ force: true });
    await service.hhRefresh();
    await service.providerConfigure({ fromInit: true });
    await service.providerAdd();
    await service.providerSet();
    await service.providerModels({ provider: 'local' });
    await service.providerModelsRefresh({ provider: 'local' });
    await service.testConnection({ employee: 'maya' });

    expect(listApi.createCommand).toHaveBeenCalledWith('c:/workspace', 'agent', { name: 'Maya' });
    expect(listApi.chatCommand).toHaveBeenCalledWith('c:/workspace', 'maya', { message: 'hello' });
    expect(listApi.hireCommand).toHaveBeenCalledWith('c:/workspace', { name: 'Maya', role: 'engineer' });
    expect(listApi.fireCommand).toHaveBeenCalledWith('c:/workspace', 'maya', { force: true });
    expect(listApi.initCommand).toHaveBeenCalledWith('c:/workspace', { force: true });
    expect(listApi.hhRefreshCommand).toHaveBeenCalledWith('c:/workspace');
    expect(listApi.providerConfigureCommand).toHaveBeenCalledWith('c:/workspace', { fromInit: true });
    expect(listApi.providerAddCommand).toHaveBeenCalledWith('c:/workspace', {});
    expect(listApi.providerSetCommand).toHaveBeenCalledWith('c:/workspace', {});
    expect(listApi.providerModelsCommand).toHaveBeenCalledWith('c:/workspace', { provider: 'local' });
    expect(listApi.providerModelsRefreshCommand).toHaveBeenCalledWith('c:/workspace', { provider: 'local' });
    expect(listApi.testConnectionCommand).toHaveBeenCalledWith('c:/workspace', { employee: 'maya' });
  });

  it('streams tool denial metadata through tool events', async () => {
    listApi.chatCommand.mockImplementation(async (_workspaceRoot, _employeeId, _options, hooks) => {
      hooks?.emit?.({
        kind: 'tool',
        toolName: 'fs_write_file',
        toolPhase: 'denied',
        message: 'Denied by policy',
        toolResult: {
          toolName: 'fs_write_file',
          outcome: 'denied',
          result: 'Denied by policy',
        },
        toolDenial: {
          kind: 'policy-denied',
          reasonCode: 'permission_denied',
          message: 'Denied by policy',
          blockedPaths: ['src/secret.ts'],
          alternativeContexts: [{ contextId: 'agent-infra', allowedPaths: ['src/secret.ts'] }],
          handoffRecommendation: {
            possible: true,
            requiresUserApproval: true,
            contexts: [{ contextId: 'agent-infra', allowedPaths: ['src/secret.ts'] }],
          },
        },
      });
    });

    const service = createAiTeamService('c:/workspace');
    const events = [] as Array<Record<string, unknown>>;
    for await (const event of service.stream({ command: 'chat', payload: { employeeId: 'maya', options: { message: 'hello' } } })) {
      events.push(event as Record<string, unknown>);
    }

    const toolEvent = events.find((event) => event.kind === 'tool');
    expect(toolEvent).toBeDefined();
    expect(toolEvent).toMatchObject({
      kind: 'tool',
      toolName: 'fs_write_file',
      toolPhase: 'denied',
      message: 'Denied by policy',
      toolDenial: {
        kind: 'policy-denied',
        reasonCode: 'permission_denied',
        blockedPaths: ['src/secret.ts'],
      },
      toolResult: {
        toolName: 'fs_write_file',
        outcome: 'denied',
        result: 'Denied by policy',
      },
    });
  });
});
