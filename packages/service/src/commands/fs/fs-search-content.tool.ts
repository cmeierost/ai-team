import path from 'node:path';
import { z } from 'zod';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
  ICommandDescriptor,
} from '@ai-team/core';
import type { FsSearchContentParams, FsSearchContentResult } from './fs-tool-types.js';
export const FsSearchContentToolMetadata = {
  key: 'search_content',
  group: 'fs',
  availableIn: { tool: true },
  description: 'Search file contents under a path. Every candidate path is access-checked.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    query: z.string().min(1).describe('Text to search for'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Maximum number of matches to return'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search (default false)'),
  }),
} satisfies ICommandDescriptor;

export class FsSearchContentTool implements ICommand<FsSearchContentParams, FsSearchContentResult> {
  readonly metadata = FsSearchContentToolMetadata;
  readonly name = 'search_content';

  constructor(
    private readonly workspaceRoot: string,
    private readonly workspaceFsFactory: IWorkspaceFsFactory
  ) {}

  async execute(
    params: FsSearchContentParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsSearchContentResult>> {
    const { path: targetPath = '.', query, maxResults = 100, caseSensitive = false } = params;

    const fs = await this.workspaceFsFactory.create(
      context.agent?.id ?? '',
      context.agent?.permissions ?? { read: [], write: [], list: [] }
    );
    const { matches: rawMatches, denied: deniedCount } = await fs.grepWithStats(query, {
      caseInsensitive: !caseSensitive,
    });

    const matches: Array<{ path: string; line: number; content: string }> = [];
    for (const match of rawMatches) {
      const relativePath = path.relative(this.workspaceRoot, match.filePath).replaceAll('\\', '/');

      if (
        targetPath !== '.' &&
        !relativePath.startsWith(targetPath.replace(/\/$/, '') + '/') &&
        relativePath !== targetPath
      ) {
        continue;
      }

      matches.push({ path: relativePath, line: match.line, content: match.lineText });
      if (matches.length >= maxResults) break;
    }

    let access: FsSearchContentResult['access'];
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
      data: { path: targetPath, query, matches, denied: deniedCount, access },
    };
  }
}
