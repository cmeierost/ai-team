/**
 * Headhunter (hh) commands - skill scouting and talent sourcing
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';

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

interface SkillCatalogEntry {
  name: string;
  description: string;
  filePath: string;
}

/**
 * Refresh skill catalog from anthropics/skills GitHub repository
 * (Jordan Blake goes headhunting for new skills)
 */
export async function hhRefreshCommand() {
  const workspaceRoot = process.cwd();
  const catalogDir = path.join(workspaceRoot, '.ai-team', 'skills-catalog');

  // Ensure catalog directory exists
  await fs.mkdir(catalogDir, { recursive: true });

  const spinner = ora('Jordan Blake is scouting skills from GitHub...').start();

  try {
    const token = process.env.GITHUB_TOKEN;
    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'ai-team-cli',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Fetch top-level skills directory listing
    const listUrl = `${GITHUB_API_BASE}/repos/${SKILLS_REPO}/contents/${SKILLS_PATH}`;
    const listResponse = await fetch(listUrl, { headers });

    if (!listResponse.ok) {
      if (listResponse.status === 403) {
        throw new Error(
          'GitHub API rate limit exceeded. Set GITHUB_TOKEN environment variable for higher limits.'
        );
      }
      throw new Error(`GitHub API error: ${listResponse.status} ${listResponse.statusText}`);
    }

    const entries: GitHubContent[] = await listResponse.json() as GitHubContent[];
    const skillDirs = entries.filter(e => e.type === 'dir');

    if (skillDirs.length === 0) {
      spinner.warn('No skills found in repository');
      return;
    }

    spinner.text = `Found ${skillDirs.length} skills. Downloading...`;

    let downloaded = 0;
    let failed = 0;

    for (const dir of skillDirs) {
      try {
        // Fetch SKILL.md from each skill directory
        const skillUrl = `${RAW_CONTENT_BASE}/${dir.name}/SKILL.md`;
        const skillResponse = await fetch(skillUrl, {
          headers: { 'User-Agent': 'ai-team-cli' },
        });

        if (!skillResponse.ok) {
          // Some directories may not have SKILL.md — skip silently
          failed++;
          continue;
        }

        const content = await skillResponse.text();

        // Save to local catalog
        const skillDir = path.join(catalogDir, dir.name);
        await fs.mkdir(skillDir, { recursive: true });
        await fs.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf-8');

        downloaded++;
        spinner.text = `Downloading skills... (${downloaded}/${skillDirs.length})`;
      } catch {
        failed++;
      }
    }

    spinner.succeed(
      chalk.green(`Jordan Blake found ${downloaded} skills and saved them to the catalog`)
    );

    if (failed > 0) {
      console.log(chalk.dim(`  (${failed} skills skipped — no SKILL.md found)`));
    }

    if (!token) {
      console.log(
        chalk.dim('\n  Tip: Set GITHUB_TOKEN env var to avoid API rate limits')
      );
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to pull skills'));
    if (error instanceof Error) {
      console.error(chalk.red(error.message));
    }
    process.exit(1);
  }
}

/**
 * List locally cached skills from the skills catalog
 * @param workspaceRoot - Workspace root directory
 * @returns Array of skill catalog entries with name and description
 */
export async function listCatalogSkills(workspaceRoot: string): Promise<SkillCatalogEntry[]> {
  const catalogDir = path.join(workspaceRoot, '.ai-team', 'skills-catalog');

  try {
    const entries = await fs.readdir(catalogDir, { withFileTypes: true });
    const skills: SkillCatalogEntry[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(catalogDir, entry.name, 'SKILL.md');
      try {
        const content = await fs.readFile(skillMdPath, 'utf-8');
        const { name, description } = parseSkillFrontmatter(content);
        skills.push({
          name: name || entry.name,
          description: description || 'No description',
          filePath: skillMdPath,
        });
      } catch {
        // Skip skills without readable SKILL.md
      }
    }

    return skills.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Read a skill's full SKILL.md content
 * @param workspaceRoot - Workspace root directory
 * @param skillName - Skill directory name
 * @returns Full SKILL.md content or null
 */
export async function readSkillContent(workspaceRoot: string, skillName: string): Promise<string | null> {
  const skillMdPath = path.join(workspaceRoot, '.ai-team', 'skills-catalog', skillName, 'SKILL.md');
  try {
    return await fs.readFile(skillMdPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Parse YAML frontmatter from SKILL.md (lightweight, no gray-matter dependency in CLI)
 */
function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};

  const frontmatter = match[1];
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim();

  return { name, description };
}
