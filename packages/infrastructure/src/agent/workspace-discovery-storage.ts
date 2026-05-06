import { IWorkspaceDiscoveryStorage } from '@ai-team/core';
import { glob } from 'glob/raw';
import path from 'node:path';

export class WorkspaceDiscoveryStorage implements IWorkspaceDiscoveryStorage {
  public async findAgentFilesAsync(workspaceRoot: string): Promise<string[]> {
    const patterns = [
      '**/agent.md',
      '**/*.agent.md',
      '.ai-team/agents/*.md',
      '.github/agents/*.md',
    ];
    const ignore = ['**/node_modules/**', '**/.git/**'];
    const allResults = await Promise.all(
      patterns.map((pattern) => glob(pattern, { cwd: workspaceRoot, absolute: true, ignore }))
    );

    return Array.from(new Set(allResults.flat())).sort((a, b) => a.localeCompare(b));
  }

  public async findSkillFilesAsync(workspaceRoot: string): Promise<string[]> {
    return glob('.ai-team/**/SKILL.md', {
      cwd: workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
  }

  public resolveAgentSkillFilePath(workspaceRoot: string, skillId: string): string {
    return path.join(workspaceRoot, '.ai-team', 'skills', skillId, 'SKILL.md');
  }

  public async findInstructionFilesAsync(workspaceRoot: string): Promise<string[]> {
    return glob('.ai-team/instructions/*.instructions.md', {
      cwd: workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });
  }
}
