import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildOnboardingTranscriptMarkdown,
  saveOnboardingTranscriptAsync,
} from './onboarding-docs.js';

describe('onboarding docs helpers', () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it('formats developer and agent speaker labels clearly', () => {
    const markdown = buildOnboardingTranscriptMarkdown({
      title: 'Team Planning',
      intro: ['> Intro line'],
      history: [
        { isHuman: true, content: 'Need a backend lead.' } as never,
        { isHuman: false, content: 'I will hire one.' } as never,
      ],
      developerLabel: 'Clemens Meier',
      agentLabel: 'Lisa Taylor (hr-director)',
    });

    expect(markdown).toContain('**Clemens Meier:** Need a backend lead.');
    expect(markdown).toContain('**Lisa Taylor (hr-director):** I will hire one.');
  });

  it('writes transcript to requested relative path', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'onboarding-docs-'));
    tempRoots.push(workspaceRoot);

    const outPath = await saveOnboardingTranscriptAsync({
      workspaceRoot,
      relativePath: path.join('.ai-team', 'meetings', 'team-planning.md'),
      title: 'Team Planning',
      intro: ['> Intro line'],
      history: [{ isHuman: true, content: 'Hello' } as never],
      developerLabel: 'Dev',
      agentLabel: 'HR',
    });

    expect(outPath).toBe(path.join(workspaceRoot, '.ai-team', 'meetings', 'team-planning.md'));

    const written = await fs.readFile(outPath, 'utf-8');
    expect(written).toContain('# Team Planning');
    expect(written).toContain('**Dev:** Hello');
  });
});
