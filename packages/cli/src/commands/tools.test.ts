import { describe, expect, it, vi, beforeEach } from 'vitest';
import { toolsAllowCommand, toolsDisallowCommand } from './tools.js';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(async () => 'michael-brown'),
  confirm: vi.fn(async () => true),
}));

describe('tools governance commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toolsAllowCommand prefers governed toolAllow when available', async () => {
    const toolAllow = vi.fn(async () => ({
      agent: { id: 'sarah-lee', name: 'Sarah Lee', role: 'chief-architect' },
      tool: 'fs_write_file',
      tools: ['fs_read', 'fs_write_file'],
      changed: true,
    }));

    const allowTool = vi.fn(async () => ({
      agent: { id: 'sarah-lee', name: 'Sarah Lee', role: 'chief-architect' },
      tool: 'fs_write_file',
      tools: ['fs_read', 'fs_write_file'],
      changed: true,
    }));

    const client = {
      toolAllow,
      allowTool,
    } as any;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await toolsAllowCommand(client, {
        agent: 'sarah-lee',
        tool: 'fs_write_file',
        requestedBy: 'michael-brown',
        approvedByUser: true,
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(toolAllow).toHaveBeenCalledWith(
      { agent: 'sarah-lee', tool: 'fs_write_file' },
      { requestedBy: 'michael-brown', approvedByUser: true },
    );
    expect(allowTool).not.toHaveBeenCalled();
  });

  it('toolsDisallowCommand falls back to legacy disallowTool when governed method is unavailable', async () => {
    const disallowTool = vi.fn(async () => ({
      agent: { id: 'sarah-lee', name: 'Sarah Lee', role: 'chief-architect' },
      tool: 'fs_write_file',
      tools: ['fs_read'],
      changed: true,
    }));

    const client = {
      disallowTool,
    } as any;

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await toolsDisallowCommand(client, {
        agent: 'sarah-lee',
        tool: 'fs_write_file',
        requestedBy: 'michael-brown',
        approvedByUser: true,
      });
    } finally {
      logSpy.mockRestore();
    }

    expect(disallowTool).toHaveBeenCalledWith({ agent: 'sarah-lee', tool: 'fs_write_file' });
  });
});
