import { IWorkspaceDiscoveryStorage } from '@ai-team/core';
import { glob } from 'glob/raw';
import path from 'node:path';

export class WorkspaceDiscoveryStorage implements IWorkspaceDiscoveryStorage {
  constructor(private readonly workspaceRoot: string) {}

  public async findAgentFilesAsync(): Promise<string[]> {
    const patterns = [
      '**/agent.md',
      '**/*.agent.md',
      '.ai-team/agents/*.md',
      '.github/agents/*.md',
    ];
    const ignore = ['**/node_modules/**', '**/.git/**'];
    const allResults = await Promise.all(
      patterns.map((pattern) => glob(pattern, { cwd: this.workspaceRoot, absolute: true, ignore }))
    );

    return Array.from(new Set(allResults.flat())).sort((a, b) => a.localeCompare(b));
  }

  public async findSkillFilesAsync(): Promise<string[]> {
    return glob('.ai-team/**/SKILL.md', {
      cwd: this.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
  }

  public resolveAgentSkillFilePath(skillId: string): string {
    return path.join(this.workspaceRoot, '.ai-team', 'skills', skillId, 'SKILL.md');
  }

  public async findInstructionFilesAsync(): Promise<string[]> {
    return glob('.ai-team/instructions/*.instructions.md', {
      cwd: this.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
  }
}
