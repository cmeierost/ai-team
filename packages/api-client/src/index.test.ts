import { describe, expect, it, vi } from 'vitest';

import { createInProcessAiTeamClient } from './index.js';

describe('createInProcessAiTeamClient', () => {
  it('forwards listEmployees requests to the service', async () => {
    const invoke = vi.fn().mockResolvedValue([{ id: 'maya' }]);
    const stream = vi.fn().mockReturnValue((async function* () {
      yield { kind: 'started', command: 'listEmployees', timestamp: new Date().toISOString() };
    })());
    const listEmployees = vi.fn().mockResolvedValue([{ name: 'Maya', role: 'engineer' }]);
    const resolveEmployees = vi.fn().mockResolvedValue([{ id: 'maya' }]);
    const getTeamGraph = vi.fn().mockResolvedValue({ nodes: [], edges: [] });
    const getOrganizationGraph = vi.fn().mockResolvedValue({ nodes: [], edges: [] });
    const create = vi.fn().mockResolvedValue(undefined);
    const chat = vi.fn().mockResolvedValue(undefined);
    const hire = vi.fn().mockResolvedValue(undefined);
    const fire = vi.fn().mockResolvedValue(undefined);
    const init = vi.fn().mockResolvedValue(undefined);
    const hhRefresh = vi.fn().mockResolvedValue(undefined);
    const providerConfigure = vi.fn().mockResolvedValue(undefined);
    const providerAdd = vi.fn().mockResolvedValue(undefined);
    const providerSet = vi.fn().mockResolvedValue(undefined);
    const providerModels = vi.fn().mockResolvedValue(undefined);
    const providerModelsRefresh = vi.fn().mockResolvedValue(undefined);
    const testConnection = vi.fn().mockResolvedValue(undefined);
    const client = createInProcessAiTeamClient({
      invoke,
      stream,
      listEmployees,
      resolveEmployees,
      getTeamGraph,
      getOrganizationGraph,
      create,
      chat,
      hire,
      fire,
      init,
      hhRefresh,
      providerConfigure,
      providerAdd,
      providerSet,
      providerModels,
      providerModelsRefresh,
      testConnection,
    });

    const request = { role: 'engineer' };
    const result = await client.listEmployees(request);

    expect(listEmployees).toHaveBeenCalledWith(request);
    expect(result).toEqual([{ name: 'Maya', role: 'engineer' }]);

    await client.resolveEmployees('maya');
    expect(resolveEmployees).toHaveBeenCalledWith('maya');

    await client.invoke({ command: 'resolveEmployees', payload: { query: 'maya' } });
    expect(invoke).toHaveBeenCalledWith({ command: 'resolveEmployees', payload: { query: 'maya' } }, {});

    const events = [] as unknown[];
    for await (const event of client.stream({ command: 'listEmployees', payload: {} })) {
      events.push(event);
    }
    expect(events.length).toBe(1);
    expect(stream).toHaveBeenCalled();

    await client.getTeamGraph('hierarchy');
    expect(getTeamGraph).toHaveBeenCalledWith('hierarchy');

    await client.getOrganizationGraph();
    expect(getOrganizationGraph).toHaveBeenCalledTimes(1);

    await client.create('agent', { name: 'Maya' });
    expect(create).toHaveBeenCalledWith('agent', { name: 'Maya' });

    await client.chat('maya', { message: 'hello' });
    expect(chat).toHaveBeenCalledWith('maya', { message: 'hello' });

    await client.hire({ name: 'Maya', role: 'engineer' });
    expect(hire).toHaveBeenCalledWith({ name: 'Maya', role: 'engineer' });

    await client.fire('maya', { force: true });
    expect(fire).toHaveBeenCalledWith('maya', { force: true });

    await client.init({ force: true });
    expect(init).toHaveBeenCalledWith({ force: true });

    await client.hhRefresh();
    expect(hhRefresh).toHaveBeenCalledTimes(1);

    await client.providerConfigure({ fromInit: true });
    expect(providerConfigure).toHaveBeenCalledWith({ fromInit: true });

    await client.providerAdd();
    expect(providerAdd).toHaveBeenCalledTimes(1);

    await client.providerSet();
    expect(providerSet).toHaveBeenCalledTimes(1);

    await client.providerModels({ provider: 'local' });
    expect(providerModels).toHaveBeenCalledWith({ provider: 'local' });

    await client.providerModelsRefresh({ provider: 'local' });
    expect(providerModelsRefresh).toHaveBeenCalledWith({ provider: 'local' });

    await client.testConnection({ employee: 'maya' });
    expect(testConnection).toHaveBeenCalledWith({ employee: 'maya' });
  });
});