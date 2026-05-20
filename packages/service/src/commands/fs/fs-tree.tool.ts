import { z } from 'zod';
import { renderAsciiTree } from 'fs-context';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
} from '@ai-team/core';
import type { FsTreeParams, FsTreeResult } from './fs-tool-types.js';
import { annotateFsTreeWithRights, matchesFsTreePreLlmIntent } from './fs-tree-helpers.js';

export class FsTreeTool implements ICommand<FsTreeParams, FsTreeResult> {
  readonly name = 'tree';
  readonly key = 'tree';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Build directory tree with access-filtered nodes.';
  readonly matchesIntent = matchesFsTreePreLlmIntent;
  readonly scorePreLlmIntent = (message: string) => {
    const text = message.trim();
    if (!text) return undefined;

    if (matchesFsTreePreLlmIntent(text)) {
      return {
        kind: 'tool' as const,
        toolName: 'fs_tree',
        args: { path: '.', maxDepth: 6, includeHidden: true },
        score: 100,
        reason: 'Explicit file-tree visibility request.',
      };
    }

    if (/\b(tree|folder structure|directory structure|project structure)\b/i.test(text)) {
      return {
        kind: 'tool' as const,
        toolName: 'fs_tree',
        args: { path: '.', maxDepth: 6, includeHidden: false },
        score: 82,
        reason: 'General workspace structure request.',
        clarification: {
          ask: {
            kind: 'select' as const,
            message: 'How deep should I scan the workspace tree before I continue?',
            choices: [
              { name: 'Quick (depth 3)', value: 'quick' },
              { name: 'Standard (depth 6)', value: 'standard', recommended: true },
              { name: 'Deep (depth 10)', value: 'deep' },
            ],
            defaultText: 'standard',
          },
          resolveArgs(answer: unknown) {
            const choice = typeof answer === 'string' ? answer : 'standard';
            let maxDepth = 6;
            if (choice === 'quick') {
              maxDepth = 3;
            } else if (choice === 'deep') {
              maxDepth = 10;
            }
            return { path: '.', maxDepth, includeHidden: false };
          },
        },
      };
    }

    return undefined;
  };
  readonly parameters = z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    maxDepth: z
      .number()
      .int()
      .min(0)
      .max(64)
      .optional()
      .describe('Maximum recursion depth (default 6)'),
    includeHidden: z.boolean().optional().describe('Include hidden files and directories'),
  });

  constructor(private readonly workspaceFsFactory: IWorkspaceFsFactory) {}

  formatForLlm(result: FsTreeResult): unknown {
    if (!result.tree) return `${result.path}: (empty or not accessible)`;
    return `${result.path}\n\n${renderAsciiTree(result.tree)}`;
  }

  async execute(
    params: FsTreeParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsTreeResult>> {
    const { path: targetPath = '.', maxDepth = 6, includeHidden = false } = params;

    const fs = await this.workspaceFsFactory.create(
      context.agent?.id ?? '',
      context.agent?.permissions ?? { read: [], write: [], list: [] }
    );
    const { tree, denied: deniedCount } = await fs.getFileTreeWithStats({
      rootSubPath: targetPath,
      maxDepth,
      includeHidden,
    });

    let access: FsTreeResult['access'];
    if (tree === null) {
      if (deniedCount > 0) {
        access = {
          allowed: false,
          explanation:
            'Content is not accessible with your current permissions. Consider delegating to an agent with broader access.',
        };
      } else {
        access = { allowed: true };
      }
    } else {
      access = {
        allowed: true,
        ...(deniedCount > 0 && {
          explanation: `${deniedCount} item(s) hidden due to access restrictions`,
        }),
      };
    }

    const treeWithRights = tree ? annotateFsTreeWithRights(tree, fs) : null;

    return {
      status: 'ok',
      data: { path: targetPath, tree: treeWithRights, denied: deniedCount, access },
    };
  }
}
