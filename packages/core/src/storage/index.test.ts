import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextLevel, RoleType } from '../types/index.js';
import { findAgentFiles, loadAgent, saveAgent } from './index.js';

const createdDirs: string[] = [];

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-storage-'));
  createdDirs.push(dir);
  return dir;
}

async function writeFile(root: string, relativePath: string, content = 'x'): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, 'utf-8');
}

async function fileExists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true; } catch { return false; }
}

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0, createdDirs.length).map((dir) => fs.rm(dir, { recursive: true, force: true }))
  );
});

describe('storage agent discovery', () => {
  it('finds agent markdown files in both ai-team and github locations', async () => {
    const workspaceRoot = await createWorkspace();

    await writeFile(workspaceRoot, '.ai-team/agents/emily-davis.agent.md');
    await writeFile(workspaceRoot, '.ai-team/agents/michael-brown.agent.md');
    await writeFile(workspaceRoot, '.github/agents/emily-davis.agent.md');
    await writeFile(workspaceRoot, '.github/agents/michael-brown.agent.md');
    await writeFile(workspaceRoot, 'docs/example.agent.md');

    const files = await findAgentFiles(workspaceRoot);
    const relativeFiles = files.map((file) => path.relative(workspaceRoot, file).replace(/\\/g, '/'));

    expect(relativeFiles).toEqual([
      '.ai-team/agents/emily-davis.agent.md',
      '.ai-team/agents/michael-brown.agent.md',
      '.github/agents/emily-davis.agent.md',
      '.github/agents/michael-brown.agent.md',
      'docs/example.agent.md',
    ]);
  });

  it('loads ai-team runtime metadata from a legacy sidecar yml file', async () => {
    const workspaceRoot = await createWorkspace();

    await writeFile(
      workspaceRoot,
      '.ai-team/agents/emily-davis.agent.md',
      `---\nname: Emily Davis\ndescription: Warm HR director and agent architect.\n---\n\n# Emily Davis\n\nPortfolio body.`
    );
    await writeFile(
      workspaceRoot,
      '.ai-team/agents/emily-davis.agent.yml',
      [
        'id: emily-davis',
        'name: Emily Davis',
        'role: hr-director',
        'type: executive',
        'contextLevel: organization',
        'reportsTo: michael-brown',
        'tools:',
        '  - fs_read',
      ].join('\n')
    );

    const agent = await loadAgent(path.join(workspaceRoot, '.ai-team/agents/emily-davis.agent.md'));

    expect(agent.id).toBe('emily-davis');
    expect(agent.name).toBe('Emily Davis');
    expect(agent.description).toBe('Warm HR director and agent architect.');
    expect(agent.role).toBe('hr-director');
    expect(agent.reportsTo).toBe('michael-brown');
    expect(agent.tools).toEqual(['fs_read']);
    expect(agent.markdown).toContain('Portfolio body.');
  });

  it('saves all agent data into a single .agent.md file (no yml sidecar)', async () => {
    const workspaceRoot = await createWorkspace();
    const filePath = path.join(workspaceRoot, '.ai-team/agents/emily-davis.agent.md');

    await saveAgent({
      id: 'emily-davis',
      name: 'Emily Davis',
      filePath,
      skillPath: path.join(workspaceRoot, '.ai-team/roles/hr-director.md'),
      createdAt: new Date().toISOString(),
      role: 'hr-director',
      type: RoleType.EXECUTIVE,
      contextLevel: ContextLevel.ORGANIZATION,
      reportsTo: 'michael-brown',
      tools: ['fs_read'],
      description: 'Warm HR director and agent architect.',
      markdown: '# Emily Davis\n\nPortfolio body.',
    });

    const markdown = await fs.readFile(filePath, 'utf-8');

    // Everything should be in the single .agent.md
    expect(markdown).toContain('name: Emily Davis');
    expect(markdown).toContain('description: Warm HR director and agent architect.');
    expect(markdown).toContain('tools:');
    expect(markdown).toContain('reportsTo: michael-brown');
    expect(markdown).toContain('id: emily-davis');
    expect(markdown).toContain('Portfolio body.');

    // No yml sidecar should exist
    const ymlPath = path.join(workspaceRoot, '.ai-team/agents/emily-davis.agent.yml');
    expect(await fileExists(ymlPath)).toBe(false);
  });

  it('removes existing yml sidecar when saving an agent', async () => {
    const workspaceRoot = await createWorkspace();
    const filePath = path.join(workspaceRoot, '.ai-team/agents/emily-davis.agent.md');
    const ymlPath = path.join(workspaceRoot, '.ai-team/agents/emily-davis.agent.yml');

    // Pre-create a legacy sidecar
    await writeFile(workspaceRoot, '.ai-team/agents/emily-davis.agent.yml', 'role: hr-director\ncontextLevel: organization');

    expect(await fileExists(ymlPath)).toBe(true);

    await saveAgent({
      id: 'emily-davis',
      name: 'Emily Davis',
      filePath,
      skillPath: path.join(workspaceRoot, '.ai-team/roles/hr-director.md'),
      createdAt: new Date().toISOString(),
      role: 'hr-director',
      type: RoleType.EXECUTIVE,
      contextLevel: ContextLevel.ORGANIZATION,
      description: 'Warm HR director.',
      markdown: '# Emily Davis',
    });

    // Sidecar should be gone now
    expect(await fileExists(ymlPath)).toBe(false);

    // All data in md file
    const markdown = await fs.readFile(filePath, 'utf-8');
    expect(markdown).toContain('role: hr-director');
    expect(markdown).toContain('contextLevel: organization');
  });

  it('round-trips all Copilot-native fields through save and load', async () => {
    const workspaceRoot = await createWorkspace();
    const filePath = path.join(workspaceRoot, '.ai-team/agents/emily-davis.agent.md');

    await saveAgent({
      id: 'emily-davis',
      name: 'Emily Davis',
      filePath,
      skillPath: path.join(workspaceRoot, '.ai-team/roles/hr-director.md'),
      createdAt: new Date().toISOString(),
      role: 'hr-director',
      type: RoleType.EXECUTIVE,
      contextLevel: ContextLevel.ORGANIZATION,
      description: 'HR director.',
      tools: ['search/codebase', 'web/fetch'],
      model: ['Claude Sonnet 4.5 (copilot)', 'GPT-5.2 (copilot)'],
      handoffs: [
        { label: 'Talk to Boss', agent: 'michael-brown', prompt: 'Here is my report.' },
      ],
      markdown: '# Emily Davis',
    });

    const reloaded = await loadAgent(filePath);
    expect(reloaded.tools).toEqual(['search/codebase', 'web/fetch']);
    expect(reloaded.model).toEqual(['Claude Sonnet 4.5 (copilot)', 'GPT-5.2 (copilot)']);
    expect(reloaded.handoffs).toEqual([
      { label: 'Talk to Boss', agent: 'michael-brown', prompt: 'Here is my report.' },
    ]);
  });

  it('preserves unknown passthrough fields across save/load', async () => {
    const workspaceRoot = await createWorkspace();
    const filePath = path.join(workspaceRoot, '.ai-team/agents/test.agent.md');

    // Write a file with a field ai-team doesn't know about
    await writeFile(
      workspaceRoot,
      '.ai-team/agents/test.agent.md',
      [
        '---',
        'name: Test Agent',
        'role: tester',
        'contextLevel: repository',
        'custom-field: hello',
        '---',
        '',
        '# Test Agent',
      ].join('\n')
    );

    const agent = await loadAgent(filePath);
    expect((agent as any)['custom-field']).toBe('hello');
  });
});
