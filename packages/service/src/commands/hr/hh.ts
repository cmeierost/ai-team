import fs from 'fs/promises';
import path from 'path';

const GITHUB_API_BASE = 'https://api.github.com';
const SKILLS_REPO = 'anthropics/skills';
const SKILLS_PATH = 'skills';
const RAW_CONTENT_BASE = `https://raw.githubusercontent.com/${SKILLS_REPO}/main/${SKILLS_PATH}`;

interface GitHubContent {
  name: string;
  path: string;
  type: 'file' | 'dir';
  download_url?: string;
}

export async function hhRefreshCommand(workspaceRoot: string) {
  const catalogDir = path.join(workspaceRoot, '.ai-team', 'skills-catalog');

  await fs.mkdir(catalogDir, { recursive: true });

  try {
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'ai-team-cli',
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const listUrl = `${GITHUB_API_BASE}/repos/${SKILLS_REPO}/contents/${SKILLS_PATH}`;
    const listResponse = await fetch(listUrl, { headers });

    if (!listResponse.ok) {
      if (listResponse.status === 403) {
        throw new Error('GitHub API rate limit exceeded. Set GITHUB_TOKEN environment variable for higher limits.');
      }
      throw new Error(`GitHub API error: ${listResponse.status} ${listResponse.statusText}`);
    }

    const entries: GitHubContent[] = await listResponse.json() as GitHubContent[];
    const skillDirs = entries.filter(e => e.type === 'dir');

    if (skillDirs.length === 0) {
      return;
    }

    let downloaded = 0;

    for (const dir of skillDirs) {
      try {
        const skillUrl = `${RAW_CONTENT_BASE}/${dir.name}/SKILL.md`;
        const skillResponse = await fetch(skillUrl, {
          headers: { 'User-Agent': 'ai-team-cli' },
        });

        if (!skillResponse.ok) {
          continue;
        }

        const content = await skillResponse.text();

        const skillDir = path.join(catalogDir, dir.name);
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');

        downloaded++;
      } catch {
        continue;
      }
    }
    void downloaded;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Failed to pull skills');
  }
}
