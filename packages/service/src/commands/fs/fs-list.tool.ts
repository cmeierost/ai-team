import { z } from 'zod';
import type { FileTreeNode } from 'fs-context';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
} from '@ai-team/core';
import type { FsListParams, FsListResult } from './fs-tool-types.js';

export class FsListTool implements ICommand<FsListParams, FsListResult> {
  readonly name = 'list';
  readonly key = 'list';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'List directory entries with access checks.';
  readonly parameters = z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    includeHidden: z.boolean().optional().describe('Include hidden entries'),
  });

  constructor(private readonly workspaceFsFactory: IWorkspaceFsFactory) {}

  formatForLlm(result: FsListResult): unknown {
    if (!result.entries?.length) return `${result.path}: (empty or not accessible)`;
    const lines = result.entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name));
    return `${result.path}  (${result.entries.length} entries)\n\n${lines.join('\n')}`;
  }

  async execute(
    params: FsListParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsListResult>> {
    const { path: targetPath = '.', includeHidden = false } = params;

    const fs = await this.workspaceFsFactory.create(
      context.agent?.id ?? '',
      context.agent?.permissions ?? { read: [], write: [], list: [] }
    );

    const { tree, denied: deniedCount } = await fs.getFileTreeWithStats({
      rootSubPath: targetPath,
      maxDepth: 2,
      includeHidden,
    });
    const children = tree?.children ?? [];

    const entries = children.map((child: FileTreeNode) => ({
      path: child.relativePath,
      name: child.name,
      isDirectory: child.isDirectory,
      size: child.size,
      modified: child.modified,
    }));

    let access: FsListResult['access'];
    if (entries.length > 0) {
      access = {
        allowed: true,
        ...(deniedCount > 0 && {
          explanation: `${deniedCount} item(s) hidden due to access restrictions`,
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
      data: { path: targetPath, entries, denied: deniedCount, access },
    };
  }
}
