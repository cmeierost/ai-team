import { IWorkspaceStorage } from '@ai-team/core';
import fs from 'node:fs/promises';
import path from 'node:path';

export class WorkspaceStorage implements IWorkspaceStorage {
  constructor(private readonly workspaceRoot: string) {}
  public async fileExistsAsync(filePath: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.workspaceRoot, filePath));
      return true;
    } catch {
      return false;
    }
  }

  public async ensureAiTeamDirectoryAsync(): Promise<void> {
    const aiTeamDir = path.join(this.workspaceRoot, '.ai-team');
    await fs.mkdir(path.join(aiTeamDir, 'agents'), { recursive: true });
    await fs.mkdir(path.join(aiTeamDir, 'instructions'), { recursive: true });
    await fs.mkdir(path.join(aiTeamDir, 'prompts'), { recursive: true });
    await fs.mkdir(path.join(aiTeamDir, 'hooks'), { recursive: true });
    await fs.mkdir(path.join(aiTeamDir, 'skills'), { recursive: true });
    await fs.mkdir(path.join(aiTeamDir, 'roles'), { recursive: true });
    await fs.mkdir(path.join(aiTeamDir, 'features'), { recursive: true });
    await fs.mkdir(path.join(aiTeamDir, 'meetings'), { recursive: true });
    await fs.mkdir(path.join(aiTeamDir, 'private', 'chats'), { recursive: true });
    await fs.mkdir(path.join(aiTeamDir, 'avatars'), { recursive: true });
    await fs.mkdir(path.join(aiTeamDir, 'skills-catalog'), { recursive: true });
  }
}
