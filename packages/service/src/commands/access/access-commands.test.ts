import { describe, expect, it, vi } from 'vitest';
import { AccessCanCommand } from './access-can.command.js';
import { AccessWhoCommand } from './access-who.command.js';

describe('access commands', () => {
  it('AccessCanCommand evaluates access for the selected agent', async () => {
    const agentManager = {
      getAllAgentsAsync: vi.fn().mockResolvedValue([
        { id: 'agent-a', name: 'Agent A', permissions: { read: ['docs/**'], write: [] } },
      ]),
      resolveAgentForOperationAsync: vi.fn().mockResolvedValue({ id: 'agent-a', name: 'Agent A' }),
      getAgentAsync: vi.fn().mockResolvedValue({
        id: 'agent-a',
        name: 'Agent A',
        permissions: { read: ['docs/**'], write: [] },
      }),
    };
    const checker = {
      can: vi.fn().mockReturnValue(true),
      canReadPath: vi.fn().mockReturnValue(true),
      canWritePath: vi.fn().mockReturnValue(false),
      canListPath: vi.fn().mockReturnValue(true),
      assertCanReadPath: vi.fn(),
      assertCanWritePath: vi.fn(),
    };

    const command = new AccessCanCommand('c:/workspace', agentManager as any, checker as any);
    const payload = { path: 'docs/readme.md', right: 'read' as const };

    const result = await command.execute(payload, { workspaceRoot: 'c:/workspace', history: [] });

    expect(result.status).toBe('ok');
    expect(result.data?.allowed).toBe(true);
  });

  it('AccessWhoCommand returns matching context ids', async () => {
    const agentManager = {
      getAllAgentsAsync: vi.fn().mockResolvedValue([
        { id: 'agent-a', name: 'Agent A', permissions: { read: ['docs/**'], write: [] } },
        { id: 'agent-b', name: 'Agent B', permissions: { read: ['src/**'], write: [] } },
      ]),
    };
    const checker = {
      can: vi.fn((right: string) => right === 'list'),
      canReadPath: vi.fn().mockReturnValue(true),
      canWritePath: vi.fn().mockReturnValue(false),
      canListPath: vi.fn().mockReturnValue(true),
      assertCanReadPath: vi.fn(),
      assertCanWritePath: vi.fn(),
    };

    const command = new AccessWhoCommand('c:/workspace', agentManager as any, checker as any);
    const payload = { path: 'docs/readme.md', right: 'list' as const };

    const result = await command.execute(payload);

    expect(result.status).toBe('ok');
    expect(result.data?.contextIds.length).toBeGreaterThan(0);
  });
});