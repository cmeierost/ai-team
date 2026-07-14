import path from 'node:path';
import { z } from 'zod';
import type { ExecutionContext, ICodeEditManager } from '@ai-team/core';
import { ExecutionContextGuards } from './execution-context-guards.js';

export interface ApplyCodeEditParams {
  description: string;
  changes: Array<{
    filePath: string;
    oldContent: string;
    newContent: string;
  }>;
}

export class ApplyCodeEditTool {
  readonly name = 'apply_patch';
  readonly key = 'apply_patch';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description =
    'Propose code changes to one or more files. Changes must be approved by the user before being applied. Requires write permission for all files.';
  readonly parameters = z.object({
    description: z.string().describe('Clear description of what changes are being made and why'),
    changes: z
      .array(
        z.object({
          filePath: z.string().describe('File path (relative or absolute)'),
          oldContent: z.string().describe('Current content of the file'),
          newContent: z.string().describe('New content after changes'),
        })
      )
      .min(1)
      .describe('List of file changes to apply'),
  });

  constructor(
    private readonly workspaceRoot: string,
    private readonly editManager: ICodeEditManager
  ) {}

  async execute(params: ApplyCodeEditParams, context: ExecutionContext): Promise<unknown> {
    const { description, changes } = params;

    const absoluteChanges = changes.map((change) => ({
      ...change,
      filePath: path.isAbsolute(change.filePath)
        ? change.filePath
        : path.join(this.workspaceRoot, change.filePath),
    }));

    const checker = ExecutionContextGuards.requirePathPermissionChecker(context);
    const blockedFiles = absoluteChanges
      .map((c) => c.filePath)
      .filter((fp) => !checker.canWritePath(context.agent!.permissions, fp));

    if (blockedFiles.length > 0) {
      return {
        status: 'permission_denied',
        message: `Agent '${context.agent!.id}' has no write access to ${blockedFiles.length} file(s).`,
        blockedFiles: blockedFiles.map((fp) => ({
          filePath: fp,
          reason: 'Write access denied',
        })),
      };
    }

    const { proposal, validation: proposalValidation } = await this.editManager.createProposal(
      context.agent!.id,
      { description, changes: absoluteChanges },
      { checkPermissions: true, maxFiles: 10, maxDiffLines: 500 }
    );

    return {
      status: 'pending_approval',
      proposalId: proposal.id,
      description: proposal.description,
      filesChanged: proposal.changes.length,
      additions: proposal.changes.reduce((sum, c) => sum + c.diff.additions, 0),
      deletions: proposal.changes.reduce((sum, c) => sum + c.diff.deletions, 0),
      warnings: proposalValidation.warnings,
      message: 'Code edit proposal created. Awaiting user approval.',
    };
  }
}
