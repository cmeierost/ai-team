import { describe, expect, it, vi } from 'vitest';
import type { Agent, ExecutionContext } from '@ai-team/core';

import { ChatSkillService } from './chat-skill-service.js';

describe('ChatSkillService', () => {
  it('caches resolved agent skills per session + agent', async () => {
    const agent = {
      id: 'clara-bishop',
      name: 'Clara Bishop',
      role: 'frontend-quality-engineer',
      skills: [],
    } as unknown as Agent;

    const resolveSkillsForAgent = vi.fn(async () => ({
      roleSkill: undefined,
      specializationSkills: [],
      skills: [{ id: 'base', name: 'base-skill' }],
      missingSkillNames: [],
    }));

    const service = new ChatSkillService({
      skillManager: {
        resolveSkillsForAgent,
        resolveSessionSkills: vi.fn(async () => ({ newlyLoaded: [], activeSkills: [] })),
      } as any,
      sessionManager: {
        getSessionSkills: vi.fn(async () => []),
        addSessionSkill: vi.fn(async () => undefined),
        appendMessage: vi.fn(async () => null),
      } as any,
      emitService: {
        log: vi.fn(),
        emit: vi.fn(),
        status: vi.fn(),
      } as any,
      workspaceRoot: '/workspace',
    });

    const session1Ctx = {
      agent,
      sessionId: 'session-1',
      history: [],
    } as unknown as ExecutionContext;

    const session2Ctx = {
      agent,
      sessionId: 'session-2',
      history: [],
    } as unknown as ExecutionContext;

    await service.resolveSkillsForTurnAsync({ userMessage: 'turn-1', ctx: session1Ctx });
    await service.resolveSkillsForTurnAsync({ userMessage: 'turn-2', ctx: session1Ctx });
    await service.resolveSkillsForTurnAsync({ userMessage: 'turn-3', ctx: session2Ctx });

    expect(resolveSkillsForAgent).toHaveBeenCalledTimes(2);
  });

  it('persists newly triggered session skills', async () => {
    const agent = {
      id: 'victor-alvarez',
      name: 'Victor Alvarez',
      role: 'assistant',
      skills: [{ id: 'session-skill-1' }],
    } as unknown as Agent;

    const addSessionSkill = vi.fn(async () => undefined);
    const appendMessage = vi.fn(async () => null);

    const service = new ChatSkillService({
      skillManager: {
        resolveSkillsForAgent: vi.fn(async () => ({
          roleSkill: undefined,
          specializationSkills: [],
          skills: [],
          missingSkillNames: [],
        })),
        resolveSessionSkills: vi.fn(async () => ({
          newlyLoaded: [
            {
              name: 'Triggered Skill',
              filePath: '/workspace/.ai-team/skills/triggered/SKILL.md',
            },
          ],
          activeSkills: [
            {
              id: 'triggered',
              name: 'Triggered Skill',
            },
          ],
        })),
      } as any,
      sessionManager: {
        getSessionSkills: vi.fn(async () => []),
        addSessionSkill,
        appendMessage,
      } as any,
      emitService: {
        log: vi.fn(),
        emit: vi.fn(),
        status: vi.fn(),
      } as any,
      workspaceRoot: '/workspace',
    });

    const ctx = {
      agent,
      sessionId: 'session-9',
      history: [],
    } as unknown as ExecutionContext;

    await service.resolveSkillsForTurnAsync({ userMessage: 'please do thing', ctx });

    expect(addSessionSkill).toHaveBeenCalledWith('session-9', '.ai-team/skills/triggered/SKILL.md');
    expect(appendMessage).toHaveBeenCalledTimes(1);

    const persistedMessage = appendMessage.mock.calls[0]?.[1] as {
      from?: string;
      tool_calls?: Array<{
        tool?: string;
        params?: { skillName?: string; skillPath?: string; triggerMessage?: string };
        result?: { status?: string; skillName?: string; skillPath?: string; message?: string };
        resultLlm?: string;
      }>;
    };

    expect(persistedMessage.from).toBe('victor-alvarez');
    expect(persistedMessage.tool_calls?.[0]?.tool).toBe('skill_load');
    expect(persistedMessage.tool_calls?.[0]?.params).toEqual({
      skillName: 'Triggered Skill',
      skillPath: '.ai-team/skills/triggered/SKILL.md',
      triggerMessage: 'please do thing',
    });
    expect(persistedMessage.tool_calls?.[0]?.result).toEqual({
      status: 'loaded',
      message: 'Loaded session skill "Triggered Skill".',
      skillName: 'Triggered Skill',
      skillPath: '.ai-team/skills/triggered/SKILL.md',
    });
    expect(persistedMessage.tool_calls?.[0]?.resultLlm).toBe(
      'Loaded session skill "Triggered Skill".'
    );
  });

  it('does not persist skill-load tool call again when session skill is already loaded', async () => {
    const agent = {
      id: 'victor-alvarez',
      name: 'Victor Alvarez',
      role: 'assistant',
      skills: [{ id: 'session-skill-1' }],
    } as unknown as Agent;

    const addSessionSkill = vi.fn(async () => undefined);
    const appendMessage = vi.fn(async () => null);

    const service = new ChatSkillService({
      skillManager: {
        resolveSkillsForAgent: vi.fn(async () => ({
          roleSkill: undefined,
          specializationSkills: [],
          skills: [],
          missingSkillNames: [],
        })),
        resolveSessionSkills: vi.fn(async () => ({
          newlyLoaded: [],
          activeSkills: [
            {
              id: 'triggered',
              name: 'Triggered Skill',
            },
          ],
        })),
      } as any,
      sessionManager: {
        getSessionSkills: vi.fn(async () => [
          {
            sessionId: 'session-9',
            skillPath: '.ai-team/skills/triggered/SKILL.md',
            paused: false,
            addedAt: new Date().toISOString(),
          },
        ]),
        addSessionSkill,
        appendMessage,
      } as any,
      emitService: {
        log: vi.fn(),
        emit: vi.fn(),
        status: vi.fn(),
      } as any,
      workspaceRoot: '/workspace',
    });

    const ctx = {
      agent,
      sessionId: 'session-9',
      history: [],
    } as unknown as ExecutionContext;

    await service.resolveSkillsForTurnAsync({ userMessage: 'please do thing', ctx });

    expect(addSessionSkill).not.toHaveBeenCalled();
    expect(appendMessage).not.toHaveBeenCalled();
  });
});
