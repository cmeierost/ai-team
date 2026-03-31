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

    const report = await analyzeWorkspacePermissionOverlap(workspaceRoot);
    expect(report.agentIds).toEqual(['alex-morgan', 'ethan-carter']);
    expect(report.rights.read.sharedAllowPatterns).toEqual([
      {
        pattern: 'packages/core/**/*',
        agentIds: ['alex-morgan', 'ethan-carter'],
        agentCount: 2,
      },
    ]);
  });
});
