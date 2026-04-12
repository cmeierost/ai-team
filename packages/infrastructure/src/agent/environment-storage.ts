import { IEnvironmentStorage } from '@ai-team/core';
import fs from 'node:fs/promises';
import path from 'node:path';

export class EnvironmentStorage implements IEnvironmentStorage {
  public getEnvPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, '.ai-team', '.env');
  }

  public async loadEnvFileAsync(workspaceRoot: string): Promise<Record<string, string>> {
    const envPath = this.getEnvPath(workspaceRoot);
    try {
      const content = await fs.readFile(envPath, 'utf-8');
      const vars: Record<string, string> = {};
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) continue;
        const key = trimmed.slice(0, eqIndex).trim();
        let value = trimmed.slice(eqIndex + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        vars[key] = value;
      }
      return vars;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw error;
    }
  }

  public async saveEnvFileAsync(
    workspaceRoot: string,
    vars: Record<string, string>
  ): Promise<void> {
    const envPath = this.getEnvPath(workspaceRoot);
    await fs.mkdir(path.dirname(envPath), { recursive: true });
    const lines = ['# AI Team secrets — DO NOT commit this file', ''];
    for (const [key, value] of Object.entries(vars)) {
      lines.push(`${key}="${value}"`);
    }
    lines.push('');
    await fs.writeFile(envPath, lines.join('\n'), 'utf-8');
  }
}
