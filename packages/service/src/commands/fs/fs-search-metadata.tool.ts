import path from 'node:path';
import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
} from '@ai-team/core';
import type { FsSearchMetadataParams, FsSearchMetadataResult } from './fs-tool-types.js';

export class FsSearchMetadataTool implements ICommand<
  FsSearchMetadataParams,
  FsSearchMetadataResult
> {
  readonly name = 'search_metadata';
  readonly key = 'search_metadata';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description =
    'Fast glob-pattern file search backed by ripgrep. Returns matching paths with size and mtime. ' +
    'Respects .gitignore by default. Use glob patterns like "**/*.ts" or "src/**/*.test.*".';
  readonly parameters = z.object({
    pattern: z
      .string()
      .min(1)
      .describe('Glob pattern to match (e.g. "**/*.ts", "src/**/*.test.*")'),
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('Maximum number of matches (default 200)'),
  });

  constructor(
    private readonly workspaceRoot: string,
    private readonly workspaceFsFactory: IWorkspaceFsFactory
  ) {}

  formatForLlm(result: FsSearchMetadataResult): unknown {
    const header = `pattern: ${result.pattern}  root: ${result.path}\n${result.numMatches} files${result.truncated ? ' (truncated)' : ''}`;
    if (!result.matches?.length) return header;
    const lines = result.matches.map((m) => `${m.path}  ${m.size}B  ${m.mtime}`);
    return `${header}\n\n${lines.join('\n')}`;
  }

  async execute(
    params: FsSearchMetadataParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsSearchMetadataResult>> {
    const { pattern, path: targetPath = '.', maxResults = 200 } = params;

    const { Ripgrep, safeStat } = await import('fs-context');
    const fs = await this.workspaceFsFactory.create(
      context.agent?.id ?? '',
      context.agent?.permissions ?? { read: [], write: [], list: [] }
    );
    const cwd = path.resolve(this.workspaceRoot, targetPath);

    const matches: Array<{ path: string; size: number; mtime: string }> = [];
    let deniedCount = 0;

    for await (const relFile of Ripgrep.files({ cwd, glob: [pattern] })) {
      const relFromRoot =
        targetPath === '.'
          ? relFile.replaceAll('\\', '/')
          : (targetPath + '/' + relFile).replaceAll('\\', '/');

      if (!fs.canList(relFromRoot)) {
        deniedCount++;
        continue;
      }

      const abs = path.resolve(cwd, relFile);
      const st = await safeStat(abs);
      if (!st) continue;

      matches.push({ path: relFromRoot, size: st.size, mtime: st.mtime.toISOString() });
      if (matches.length >= maxResults) break;
    }

    let access: FsSearchMetadataResult['access'];
    if (matches.length > 0) {
      access = {
        allowed: true,
        ...(deniedCount > 0 && {
          explanation: `${deniedCount} file(s) hidden due to access restrictions`,
        }),
      };
    } else if (deniedCount > 0) {
      access = {
        allowed: false,
        explanation:
          'Content is not accessible with your current permissions. Consider delegating to an agent with broader access.',
      };
    } else {
      access = { allowed: true };
    }

    return {
      status: 'ok',
      data: {
        pattern,
        path: targetPath,
        matches,
        numMatches: matches.length,
        truncated: matches.length >= maxResults,
        denied: deniedCount,
        access,
      },
    };
  }
}
