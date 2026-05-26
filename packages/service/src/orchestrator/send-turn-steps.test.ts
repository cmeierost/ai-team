import { describe, expect, it, vi } from 'vitest';
import type { Agent, ExecutionContext } from '@ai-team/core';
import { resolveSkillsAndToolsAsync } from './send-turn-steps.js';
import type { SendTurnDeps } from './send-turn-steps.js';
import { setServiceContainer } from '../service-registry.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';

function makeTool(name: string) {
  const [group, ...rest] = name.split('_');
  return {
    metadata: {
      key: rest.join('_'),
      group,
      description: `${name} description`,
      availableIn: { tool: true },
    },
    execute: async () => ({ ok: true }),
  };
}

describe('resolveSkillsAndToolsAsync', () => {
  it('describes only agent-allowed discovered tools', async () => {
    const agent = {
      id: 'victor-alvarez',
      name: 'Victor Alvarez',
      role: 'assistant',
      tools: ['fs_*'],
      disallowedTools: [],
    } as Agent;

    const ctx = {
      agent,
      workspaceRoot: '/workspace',
      sessionId: 'session-1',
      history: [],
    } as unknown as ExecutionContext;

    const skillManager = {
      resolveSkillsForAgent: vi.fn(async () => ({
        roleSkill: undefined,
        specializationSkills: [],
        skills: [],
        missingSkillNames: [],
      })),
      resolveSessionSkills: vi.fn(async () => ({ newlyLoaded: [], activeSkills: [] })),
    } as any;

    const sessionManager = {
      getSessionSkills: vi.fn(async () => []),
      addSessionSkill: vi.fn(async () => {}),
      appendMessage: vi.fn(async () => null),
    } as any;

    const agentManager = {
      getAllAgentsAsync: vi.fn(async () => [agent]),
    };

    setServiceContainer({
      resolve: (token: { id?: string }) => {
        if (token?.id === COMMAND_FACTORY_TOKENS.AgentManager.id) return agentManager;
        throw new Error(`Unexpected token: ${String(token?.id)}`);
      },
    } as any);

    const deps: SendTurnDeps = {
      skillManager,
      sessionManager,
      llmService: undefined,
      hooks: {} as any,
      emitService: { log: vi.fn(), emit: vi.fn(), status: vi.fn() } as any,
    };

    const plugins = {
      toolResolver: {
        resolve: vi.fn(async () => [makeTool('fs_read')]),
      },
      mcpGateway: {
        discover: vi.fn(async () => [makeTool('mcp_secret')]),
      },
      llmSelector: {
        select: vi.fn(async () => undefined),
      },
      hookPlugins: [],
    } as any;

    const resolved = await resolveSkillsAndToolsAsync('read file', plugins, ctx, deps);

    expect(resolved.toolDefs.map((tool) => tool.name)).toEqual(['fs_read']);
    expect(resolved.allTools.map((tool) => `${tool.metadata.group}_${tool.metadata.key}`)).toEqual([
      'fs_read',
    ]);
  });
});
