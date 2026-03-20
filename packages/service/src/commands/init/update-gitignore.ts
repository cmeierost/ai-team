import fs from 'node:fs/promises';
import path from 'node:path';

const GITIGNORE_ADDITIONS = `
# AI Team private data
.ai-team/private/
.ai-team/logs/
.ai-team/.env
.ai-team/config.developer.json
**/*.jsonl
`;

export async function updateGitignore(workspaceRoot: string): Promise<void> {
  const gitignorePath = path.join(workspaceRoot, '.gitignore');

  try {
    let content = await fs.readFile(gitignorePath, 'utf-8');
    if (!content.includes('.ai-team/private/')) {
      content += GITIGNORE_ADDITIONS;
      await fs.writeFile(gitignorePath, content, 'utf-8');
    }
  } catch {
    await fs.writeFile(gitignorePath, GITIGNORE_ADDITIONS.trim(), 'utf-8');
  }
}
