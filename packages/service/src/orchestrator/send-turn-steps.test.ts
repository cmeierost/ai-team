import { describe, expect, it, vi } from 'vitest';
import type { Agent, ExecutionContext, ICommand } from '@ai-team/core';
import { resolveSkillsAndToolsAsync } from './send-turn-steps.js';

function makeTool(name: string): ICommand {
  const [group, ...rest] = name.split('_');
  return {
    key: rest.join('_'),
    group,
    description: `${name} description`,
    availableIn: { tool: true },
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
      hooks: {},
      skillManager: {
        resolveSkillsForAgent: vi.fn(async () => ({
          roleSkill: undefined,
          specializationSkills: [],
          skills: [],
          missingSkillNames: [],
        })),
      },
      sessionManager: {
        getSessionSkills: vi.fn(async () => []),
      },
      agentManager: {
        getAllAgentsAsync: vi.fn(async () => [agent]),
      },
      toolManager: {
        toSchema: vi.fn((toolName: string) => ({
          name: toolName,
          description: `${toolName} schema`,
          parameters: { type: 'object', properties: {} },
        })),
      },
    } as unknown as ExecutionContext;

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

    const resolved = await resolveSkillsAndToolsAsync('read file', plugins, ctx);

    expect(resolved.toolDefs.map((tool) => tool.name)).toEqual(['fs_read']);
    expect(resolved.allTools.map((tool) => `${tool.group}_${tool.key}`)).toEqual(['fs_read']);
  });
});
