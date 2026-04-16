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

  function createService(sessionMessages: Array<any>, writePatterns: string[]) {
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
      getSessionMessages: async () => sessionMessages,
      getSessionSkills: async () => [],
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

    return new MetaService(agentManager, sessionManager, skillManager, toolManager);
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
});
