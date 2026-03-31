import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeWorkspacePermissionOverlap, loadAgentPermissionRules } from './perm-overlap.js';

const tempRoots: string[] = [];

async function createWorkspaceFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ai-team-perm-overlap-'));
  tempRoots.push(root);
  await mkdir(path.join(root, '.ai-team', 'agents'), { recursive: true });
  return root;
}

async function writeAgentMd(root: string, id: string, frontmatter: string, body = ''): Promise<void> {
  await writeFile(
    path.join(root, '.ai-team', 'agents', `${id}.agent.md`),
    `---\n${frontmatter}\n---\n${body}`,
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('permission overlap workspace loading', () => {
  it('loads agent .perm files from the workspace agents directory', async () => {
    const workspaceRoot = await createWorkspaceFixture();
    await writeFile(
      path.join(workspaceRoot, '.ai-team', 'agents', 'ethan-carter.perm'),
      '[write]\r\npackages\\core\\**\\*\r\n',
      'utf8',
    );

    const rulesByAgent = await loadAgentPermissionRules(workspaceRoot);
    expect(rulesByAgent.get('ethan-carter')).toEqual([
      {
        right: 'write',
        effect: 'allow',
        pathPattern: 'packages/core/**/*',
        label: 'access-file section: write',
      },
    ]);
  });

  it('analyzes overlap across loaded .perm files', async () => {
    const workspaceRoot = await createWorkspaceFixture();
    await writeFile(
      path.join(workspaceRoot, '.ai-team', 'agents', 'ethan-carter.perm'),
      '[write]\npackages/core/**/*\n',
      'utf8',
    );
    await writeFile(
      path.join(workspaceRoot, '.ai-team', 'agents', 'alex-morgan.perm'),
      '[read]\npackages/core/**/*\n',
      'utf8',
    );

    const report = await analyzeWorkspacePermissionOverlap(workspaceRoot, { mode: 'patterns' });
    expect(report.kind).toBe('patterns');
    expect(report.agentIds).toEqual(['alex-morgan', 'ethan-carter']);
    expect(report.rights.read.sharedAllowPatterns).toEqual([
      {
        pattern: 'packages/core/**/*',
        agentIds: ['alex-morgan', 'ethan-carter'],
        agentCount: 2,
      },
    ]);
  });

  it('analyzes file overlap, selected-agent overlap, and line responsibility across the workspace', async () => {
    const workspaceRoot = await createWorkspaceFixture();
    await writeAgentMd(workspaceRoot, 'ethan-carter', 'name: Ethan Carter\nrole: platform\ncontextLevel: feature');
    await writeAgentMd(workspaceRoot, 'alex-morgan', 'name: Alex Morgan\nrole: backend\ncontextLevel: feature');
    await writeFile(
      path.join(workspaceRoot, '.ai-team', 'agents', 'ethan-carter.perm'),
      '[write]\nsrc/**/*.ts\n',
      'utf8',
    );
    await writeFile(
      path.join(workspaceRoot, '.ai-team', 'agents', 'alex-morgan.perm'),
      '[write]\nsrc/shared.ts\n[read]\nsrc/**/*.md\n',
      'utf8',
    );
    await mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await writeFile(path.join(workspaceRoot, 'src', 'shared.ts'), 'line 1\nline 2\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'src', 'solo.ts'), 'solo line\n', 'utf8');
    await writeFile(path.join(workspaceRoot, 'src', 'guide.md'), 'doc line 1\ndoc line 2', 'utf8');

    const report = await analyzeWorkspacePermissionOverlap(workspaceRoot, { agentId: 'ethan-carter' });
    expect(report.kind).toBe('files');
    expect(report.workspaceFileCount).toBe(7);
    expect(report.rights.write.overlappingFiles.some((file) => file.path === 'src/shared.ts')).toBe(true);
    expect(report.rights.write.uncoveredFiles.some((file) => file.path === 'src/guide.md')).toBe(true);
    const ethanWrite = report.rights.write.agentResponsibilities.find((entry) => entry.agentId === 'ethan-carter');
    expect(ethanWrite?.byExtension).toContainEqual({ extension: '.ts', fileCount: 2, lineCount: 5 });
    expect(report.agentFocus?.rights.write.overlapsWith).toEqual([
      expect.objectContaining({
        otherAgentId: 'alex-morgan',
        sharedFileCount: 1,
      }),
    ]);
  });
});
