import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MetaService } from './meta-service.js';

function instruction(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

describe('MetaService.getContextEstimate instruction relevance', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-meta-service-'));
    await fs.mkdir(path.join(workspaceRoot, '.ai-team', 'instructions'), { recursive: true });

    await fs.writeFile(
      path.join(workspaceRoot, '.ai-team', 'instructions', 'backend-team.instructions.md'),
      instruction(
        'applyTo: "packages/service/**/*,packages/api-server/**/*"',
        'Backend instruction content.'
      ),
      'utf-8'
    );

    await fs.writeFile(
      path.join(workspaceRoot, '.ai-team', 'instructions', 'frontend-team.instructions.md'),
      instruction('applyTo: "packages/web/**/*"', 'Frontend instruction content.'),
      'utf-8'
    );
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  function createService(
    sessionMessages: Array<any>,
    writePatterns: string[],
    options?: {
      notesByAgentId?: Record<string, Array<any>>;
      planning?: {
        tasks?: Array<any>;
        plansById?: Record<string, any>;
        todosByTaskId?: Record<string, Array<any>>;
      };
    }
  ) {
    const agent = {
      id: 'alex',
      name: 'Alex Morgan',
      role: 'Backend Lead',
      permissions: { write: writePatterns },
      personality: {},
      contextLevel: 'leadership',
    } as any;

    const agentManager = {
      workspaceRoot,
      getAgentAsync: async () => agent,
      getAllAgentsAsync: async () => [agent],
    } as any;

    const sessionManager = {
      getSession: async (sessionId: string) => ({
        id: sessionId,
        agentId: 'alex',
      }),
      getSessionMessages: async () => sessionMessages,
      getSessionSkills: async () => [],
      listAgentNotes: async (agentId: string) => options?.notesByAgentId?.[agentId] ?? [],
      listNoteSessionSharesAsync: async () => [],
    } as any;

    const skillManager = {
      resolveSkillsForAgent: async () => ({
        roleSkill: undefined,
        specializationSkills: [],
        missingSkillNames: [],
        skills: [],
      }),
    } as any;

    const toolManager = {
      getForAgent: () => [],
      toSchema: () => undefined,
    } as any;

    const agentDocumentStorage = {
      loadAllInstructionFilesAsync: async () => [
        {
          filePath: path.join(workspaceRoot, '.ai-team', 'instructions', 'backend-team.instructions.md'),
          applyTo: 'packages/service/**/*,packages/api-server/**/*',
          instructions: 'Backend instruction content.',
        },
        {
          filePath: path.join(workspaceRoot, '.ai-team', 'instructions', 'frontend-team.instructions.md'),
          applyTo: 'packages/web/**/*',
          instructions: 'Frontend instruction content.',
        },
      ],
    } as any;

    const planningService = {
      listTasks: async () => options?.planning?.tasks ?? [],
      getPlan: async (planId: string) => options?.planning?.plansById?.[planId],
      listTodos: async (taskId: string) => options?.planning?.todosByTaskId?.[taskId] ?? [],
    } as any;

    return new MetaService(
      agentManager,
      sessionManager,
      skillManager,
      toolManager,
      agentDocumentStorage,
      undefined,
      planningService
    );
  }

  it('does not include workspace instructions for initial context without sessionId', async () => {
    const service = createService([], ['packages/service/**/*']);

    const estimate = (await service.getContextEstimate('alex')) as any;

    expect(estimate.instructionFiles).toEqual([]);
    expect(estimate.segments.some((s: any) => s.key === 'instructions')).toBe(false);
  });

  it('includes only instructions relevant to files written in-session and in write scope', async () => {
    const service = createService(
      [
        {
          archived: false,
          isHuman: false,
          content: 'Updated backend behavior.',
          tool_calls: [
            {
              tool: 'fs_write_file',
              params: { filePath: 'packages/service/src/routers/meta-service.ts', content: 'x' },
            },
          ],
        },
      ],
      ['packages/service/**/*', 'packages/api-server/**/*']
    );

    const estimate = (await service.getContextEstimate('alex', { sessionId: 's1' })) as any;

    const instructionLabels = estimate.instructionFiles.map((f: any) => f.label);
    expect(instructionLabels).toContain('backend-team.instructions.md');
    expect(instructionLabels).not.toContain('frontend-team.instructions.md');
    expect(estimate.segments.some((s: any) => s.key === 'instructions')).toBe(true);
  });

  it('includes messages and tool_results segments for session context', async () => {
    const service = createService(
      [
        {
          archived: false,
          isHuman: true,
          content: 'Please update backend context metrics.',
          tool_calls: [],
        },
        {
          archived: false,
          isHuman: false,
          content: '',
          tool_calls: [
            {
              tool: 'fs_write_file',
              params: { filePath: 'packages/service/src/routers/meta-service.ts', content: 'x' },
            },
          ],
        },
      ],
      ['packages/service/**/*']
    );

    const estimate = (await service.getContextEstimate('alex', { sessionId: 's2' })) as any;

    expect(estimate.messages.length).toBeGreaterThan(0);
    expect(estimate.messages.some((m: any) => m.toolCallCount > 0)).toBe(true);
    expect(estimate.segments.some((s: any) => s.key === 'messages')).toBe(true);
    expect(estimate.segments.some((s: any) => s.key === 'tool_results')).toBe(true);
  });

  it('excludes hidden messages, prefers resultLlm for tool results, and includes visible notes with compacted fallback', async () => {
    const service = createService(
      [
        {
          archived: false,
          hiddenFromLlm: true,
          isHuman: true,
          content: 'Hidden message should not be measured.',
          tool_calls: [],
        },
        {
          archived: false,
          hiddenFromLlm: false,
          isHuman: false,
          content: 'Visible assistant message',
          tool_calls: [
            {
              tool: 'fs_write_file',
              params: { filePath: 'packages/service/src/routers/meta-service.ts' },
              result: 'this raw result should be ignored in favor of resultLlm',
              resultLlm: 'compact llm tool result',
            },
          ],
        },
      ],
      ['packages/service/**/*'],
      {
        notesByAgentId: {
          alex: [
            {
              id: 'n1',
              sessionId: 's-main',
              title: 'Main note',
              content: 'full note content',
              compactedContent: 'main compacted',
              sharedSessionIds: [],
              hiddenFromLlm: false,
              updatedAt: '2026-03-09T08:31:00.000Z',
            },
            {
              id: 'n-hidden',
              sessionId: 's-main',
              title: 'Hidden note',
              content: 'should not count',
              compactedContent: 'should not count',
              sharedSessionIds: [],
              hiddenFromLlm: true,
              updatedAt: '2026-03-09T08:31:10.000Z',
            },
            {
              id: 'n2',
              sessionId: 's-sibling',
              title: 'Shared note',
              content: 'shared note content',
              compactedContent: '',
              sharedSessionIds: ['s-main'],
              hiddenFromLlm: false,
              updatedAt: '2026-03-09T08:32:00.000Z',
            },
            {
              id: 'n3',
              sessionId: 's-sibling',
              title: 'Unshared sibling note',
              content: 'not visible to main session',
              compactedContent: '',
              sharedSessionIds: [],
              hiddenFromLlm: false,
              updatedAt: '2026-03-09T08:33:00.000Z',
            },
          ],
        },
        planning: {
          tasks: [
            {
              id: 't1',
              planId: 'p1',
              title: 'Implement estimate fix',
              description: 'Align session note semantics',
              status: 'in-progress',
              priority: 'high',
            },
          ],
          plansById: {
            p1: {
              id: 'p1',
              title: 'Context estimate correctness',
              goal: 'Accurate context panel accounting',
              status: 'active',
              priority: 'high',
            },
          },
          todosByTaskId: {
            t1: [
              { id: 'td1', content: 'Update service estimate', done: true },
              { id: 'td2', content: 'Update web rendering', done: false },
            ],
          },
        },
      }
    );

    const estimate = (await service.getContextEstimate('alex', { sessionId: 's-main' })) as any;

    expect(estimate.messages).toHaveLength(1);
    expect(estimate.messages[0].preview).toContain('Visible assistant message');
    expect(estimate.messages[0].toolChars).toBeGreaterThan('compact llm tool result'.length);
    expect(estimate.messages[0].toolRawChars).toBeGreaterThan(estimate.messages[0].toolChars);
    expect(estimate.messages[0].toolSavedChars).toBeGreaterThan(0);
    expect(estimate.messages[0].compactedToolCallCount).toBe(1);

    expect(estimate.notes).toHaveLength(2);
    expect(estimate.notes.map((n: any) => n.id)).toEqual(['n2', 'n1']);

    const shared = estimate.notes.find((n: any) => n.id === 'n2');
    expect(shared?.source).toBe('content');
    expect(shared?.chars).toBe('shared note content'.length);

    const compacted = estimate.notes.find((n: any) => n.id === 'n1');
    expect(compacted?.source).toBe('compacted');
    expect(compacted?.chars).toBe('main compacted'.length);

    const notesSegment = estimate.segments.find((s: any) => s.key === 'notes');
    expect(notesSegment?.chars).toBe('shared note content'.length + 'main compacted'.length);

    const plansSegment = estimate.segments.find((s: any) => s.key === 'plans');
    const tasksSegment = estimate.segments.find((s: any) => s.key === 'tasks');
    const todosSegment = estimate.segments.find((s: any) => s.key === 'todos');

    expect(estimate.plans).toHaveLength(1);
    expect(estimate.tasks).toHaveLength(1);
    expect(estimate.todos).toHaveLength(2);
    expect(plansSegment?.chars).toBeGreaterThan(0);
    expect(tasksSegment?.chars).toBeGreaterThan(0);
    expect(todosSegment?.chars).toBeGreaterThan(0);
  });

  it('returns chat workflow definition in both JSON and YAML formats', async () => {
    const service = createService([], ['packages/service/**/*']);

    const definition = await service.getWorkflowDefinition('chat-full-loop');

    expect(definition.workflowId).toBe('chat-full-loop');
    expect(definition.format).toBe('workflow/v1');
    expect(definition.definitionJson).toMatchObject({
      id: 'chat-full-loop',
      initial: 'preturn',
    });
    expect(definition.definitionYaml).toContain('id: chat-full-loop');
    expect(definition.definitionYaml).toContain('states:');
  });

  it('returns send-turn workflow definition in both JSON and YAML formats', async () => {
    const service = createService([], ['packages/service/**/*']);

    const definition = await service.getWorkflowDefinition('chat-send-turn');

    expect(definition.workflowId).toBe('chat-send-turn');
    expect(definition.format).toBe('workflow/v1');
    expect(definition.definitionJson).toMatchObject({
      id: 'chat-send-turn',
      initial: 'ensureTurnStart',
    });
    expect(definition.definitionYaml).toContain('id: chat-send-turn');
    expect(definition.definitionYaml).toContain('states:');
  });

  it('returns definitions for all declared chat workflow IDs', async () => {
    const service = createService([], ['packages/service/**/*']);

    const knownIds = [
      'chat-full-loop',
      'chat-preturn-interceptors',
      'chat-send-turn',
      'chat-tool-round',
      'chat-post-turn-resolution',
      'chat-handoff-transition',
      'chat-turn-failure',
    ];

    for (const workflowId of knownIds) {
      const definition = await service.getWorkflowDefinition(workflowId);
      expect(definition.workflowId).toBe(workflowId);
      expect(definition.format).toBe('workflow/v1');
      expect(definition.definitionJson.id).toBe(workflowId);
      expect(definition.definitionYaml).toContain(`id: ${workflowId}`);
    }
  });

  it('throws for unknown workflow definitions', async () => {
    const service = createService([], ['packages/service/**/*']);

    await expect(service.getWorkflowDefinition('unknown-workflow')).rejects.toThrow(
      "Workflow definition 'unknown-workflow' is not available."
    );
  });
});
