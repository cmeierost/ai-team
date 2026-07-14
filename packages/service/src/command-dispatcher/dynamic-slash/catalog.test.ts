import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ISkillManager, Skill } from '@ai-team/core';
import { EmitService } from '../../interaction/emit-service.js';
import {
  DynamicSlashCatalogService,
  DynamicSlashCommandFactory,
  DynamicSlashKeyNormalizer,
} from './catalog.js';

function stubSkillManager(skills: Skill[]): ISkillManager {
  return {
    refresh: async () => undefined,
    getAllSkills: async () => skills,
    getSkill: async () => undefined,
    resolveSkillsForAgent: async () => ({
      roleSkill: undefined,
      specializationSkills: [],
      skills: [],
      missingSkillNames: [],
    }),
    createSkillAsync: async () => {
      throw new Error('not implemented');
    },
    updateSkill: async () => {
      throw new Error('not implemented');
    },
    matchTriggersForMessage: () => false,
    resolveSessionSkills: async () => ({ newlyLoaded: [], activeSkills: [] }),
  };
}

async function createTempWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-dynamic-slash-'));
}

async function writeSkillFile(
  workspaceRoot: string,
  relativePath: string,
  frontmatter: Record<string, string>,
  instructions: string,
  modifiedAt: Date
): Promise<string> {
  const absolutePath = path.join(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });

  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');

  const content = `---\n${yaml}\n---\n\n${instructions}\n`;
  await fs.writeFile(absolutePath, content, 'utf-8');
  await fs.utimes(absolutePath, modifiedAt, modifiedAt);
  return absolutePath;
}

async function writeWorkflowFile(
  workspaceRoot: string,
  relativePath: string,
  workflow: Record<string, unknown>
): Promise<string> {
  const absolutePath = path.join(workspaceRoot, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(workflow, null, 2), 'utf-8');
  return absolutePath;
}

describe('dynamic slash catalog', () => {
  it('normalizes slash keys to kebab-case lowercase', () => {
    const normalizer = new DynamicSlashKeyNormalizer();
    expect(normalizer.normalize('Code Review')).toBe('code-review');
    expect(normalizer.normalize('CODE_review')).toBe('code-review');
    expect(normalizer.normalize('  --Plan  Alpha--  ')).toBe('plan-alpha');
  });

  it('skips skill keys that conflict with built-in commands and warns', async () => {
    const workspaceRoot = await createTempWorkspace();
    const filePath = await writeSkillFile(
      workspaceRoot,
      '.ai-team/skills/help/SKILL.md',
      {
        name: 'help',
        description: 'Conflicting skill',
      },
      'Use when testing command collision.',
      new Date('2026-05-10T08:00:00.000Z')
    );

    const skillManager = stubSkillManager([
      {
        filePath,
        name: 'help',
        description: 'Conflicting skill',
        instructions: 'Use when testing command collision.',
      } as Skill,
    ]);

    const result = await new DynamicSlashCatalogService({
      workspaceRoot,
      skillManager,
      reservedKeys: ['help'],
    }).buildAsync();

    expect(result.entries).toHaveLength(0);
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('conflicts with built-in /help')])
    );
  });

  it('chooses newer duplicate skills and warns', async () => {
    const workspaceRoot = await createTempWorkspace();

    const olderPath = await writeSkillFile(
      workspaceRoot,
      '.ai-team/skills/legacy/SKILL.md',
      {
        name: 'Code Review',
        description: 'Older skill description',
      },
      'Older skill instructions.',
      new Date('2026-05-10T08:00:00.000Z')
    );

    const newerPath = await writeSkillFile(
      workspaceRoot,
      '.ai-team/skills/newer/SKILL.md',
      {
        name: 'code-review',
        description: 'Newer skill description',
      },
      'Newer skill instructions.',
      new Date('2026-05-10T09:00:00.000Z')
    );

    const skillManager = stubSkillManager([
      {
        filePath: olderPath,
        name: 'Code Review',
        description: 'Older skill description',
        instructions: 'Older skill instructions.',
      } as Skill,
      {
        filePath: newerPath,
        name: 'code-review',
        description: 'Newer skill description',
        instructions: 'Newer skill instructions.',
      } as Skill,
    ]);

    const result = await new DynamicSlashCatalogService({
      workspaceRoot,
      skillManager,
    }).buildAsync();

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.key).toBe('code-review');
    expect(result.entries[0]?.description).toBe('Newer skill description');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Duplicate skill key /code-review')])
    );
  });

  it('chooses newer duplicate prompts and falls back to first content line for description', async () => {
    const workspaceRoot = await createTempWorkspace();

    await writeSkillFile(
      workspaceRoot,
      '.ai-team/prompts/review.prompt.md',
      {
        name: 'Code Review',
        description: 'Older prompt description',
      },
      'Older prompt body.',
      new Date('2026-05-10T07:00:00.000Z')
    );

    await writeSkillFile(
      workspaceRoot,
      '.github/prompts/code-review.prompt.md',
      {
        name: 'code_review',
      },
      'First line used as fallback description.\n\nMore details.',
      new Date('2026-05-10T11:00:00.000Z')
    );

    const result = await new DynamicSlashCatalogService({
      workspaceRoot,
      skillManager: stubSkillManager([]),
    }).buildAsync();

    const codeReview = result.entries.find((entry) => entry.key === 'code-review');
    expect(codeReview).toBeDefined();
    expect(codeReview?.description).toBe('First line used as fallback description.');
    expect(result.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('Duplicate prompt key /code-review')])
    );
  });

  it('throws when dynamic slash command entries contain duplicate keys', () => {
    expect(() =>
      new DynamicSlashCommandFactory(EmitService.noop()).buildCommands([
        {
          key: 'code-review',
          usage: '/code-review',
          name: 'code-review',
          description: 'desc',
          filePath: 'a',
          instructions: 'one',
          source: 'skill',
          modifiedAtMs: 1,
        },
        {
          key: 'code-review',
          usage: '/code-review',
          name: 'code-review',
          description: 'desc',
          filePath: 'b',
          instructions: 'two',
          source: 'workflow',
          modifiedAtMs: 2,
        },
      ])
    ).toThrow(/duplicate dynamic slash key/i);
  });

  it('throws when dynamic slash registry entry key is not normalized', () => {
    expect(() =>
      new DynamicSlashCommandFactory(EmitService.noop()).toChatCommandRegistryEntries([
        {
          key: 'Code Review',
          usage: '/Code Review',
          name: 'Code Review',
          description: 'desc',
          filePath: 'a',
          instructions: 'one',
          source: 'skill',
          modifiedAtMs: 1,
        },
      ])
    ).toThrow(/is not normalized/i);
  });

  it('supports configurable prompt/skill/workflow globs and workflow tool naming', async () => {
    const workspaceRoot = await createTempWorkspace();

    const customSkillPath = await writeSkillFile(
      workspaceRoot,
      '.custom/skills/release/SKILL.md',
      { name: 'release-skill', description: 'Skill from custom glob' },
      'Use this custom release skill.',
      new Date('2026-05-11T00:30:00.000Z')
    );

    await writeWorkflowFile(workspaceRoot, '.custom/workflows/publish.json', {
      id: 'publish-flow',
      name: 'Publish Flow',
      description: 'Workflow from custom glob',
      steps: [
        {
          kind: 'input',
          id: 'q1',
          message: 'Question',
          storeAs: 'answer',
        },
      ],
    });

    await writeSkillFile(
      workspaceRoot,
      '.custom/prompts/release.prompt.md',
      { name: 'Release Notes', description: 'Prompt from custom glob' },
      'Generate release notes.',
      new Date('2026-05-11T01:00:00.000Z')
    );

    const result = await new DynamicSlashCatalogService({
      workspaceRoot,
      skillManager: stubSkillManager([
        {
          filePath: customSkillPath,
          name: 'release-skill',
          description: 'Skill from custom glob',
          instructions: 'Use this custom release skill.',
        } as Skill,
      ]),
      dynamicSlashCatalog: {
        promptGlobs: ['.custom/prompts/**/*.prompt.md'],
        skillGlobs: ['.custom/skills/**/SKILL.md'],
        workflowGlobs: ['.custom/workflows/**/*.json'],
      },
    }).buildAsync();

    const skill = result.entries.find((entry) => entry.source === 'skill');
    const prompt = result.entries.find((entry) => entry.source === 'prompt');
    const workflow = result.entries.find((entry) => entry.source === 'workflow');

    expect(skill?.key).toBe('release-skill');
    expect(prompt?.key).toBe('release-notes');
    expect(workflow?.key).toBe('publish-flow');
    expect(workflow?.name).toBe('workflow_publish-flow');
  });
});
