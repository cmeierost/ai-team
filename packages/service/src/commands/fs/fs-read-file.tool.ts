import { z } from 'zod';
import { READ_DEFAULT_LIMIT, listCachedWorkspaceFiles } from 'fs-context';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IFuzzyFileSearch,
  IWorkspaceFsFactory,
  ICommandDescriptor,
} from '@ai-team/core';
import { mapReadResult, failed } from './fs-tools-helpers.js';
import type { FsReadParams, FsReadResult } from './fs-tool-types.js';
export const FsReadFileToolMetadata = {
  key: 'read',
  group: 'fs',
  availableIn: { tool: true, chat: true },
  usage: '<filePath> [offset] [limit]',
  examples: [
    '/fs read packages/service/src/commands/fs/fs-tool-types.ts',
    '/fs read packages/service/src/commands/fs/fs-tool-types.ts 105 55',
  ],
  description: [
    'Read a file through access checks with structured access metadata.',
    'Reads line-by-line internally (never buffers the whole file into memory).',
    'Supports pagination via `offset` (1-based start line) and `limit` (max lines).',
    'Slash/CLI positional form is `<filePath> [offset] [limit]`; omitted offset defaults to 1 and omitted limit to the standard read limit.',
    'Text content is returned without inline line-number prefixes.',
    'Structured results include `startLine`, `endLine`, and `isFullFile` so callers know which slice was returned.',
    'Lines longer than 2000 chars are truncated; output is capped at 50 KB.',
    'If the file is not found, suggests similar filenames the agent can access.',
    'If the path is a directory, returns a paginated listing (supports offset/limit).',
    'Image files and PDFs are returned as base64 data with their MIME type.',
    'Binary files are detected and a notice is returned instead of raw bytes.',
    'Tracking: records read time so fs_edit can validate staleness.',
  ].join(' '),
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    offset: z.number().int().min(1).optional().describe('1-based line to start from (default 1)'),
    limit: z.number().int().min(1).optional().describe('Max lines to return (default 2000)'),
  }),
} satisfies ICommandDescriptor;

export class FsReadFileTool implements ICommand<FsReadParams, FsReadResult> {
  readonly metadata = FsReadFileToolMetadata;
  readonly name = 'read';

  constructor(
    private readonly workspaceRoot: string,
    private readonly workspaceFsFactory: IWorkspaceFsFactory,
    private readonly fuzzyFileSearch: IFuzzyFileSearch
  ) {}

  formatForLlm(result: FsReadResult): unknown {
    if (typeof result.content !== 'string') return result;
    const isFullFile = result.isFullFile === true;
    const pathLabel = typeof result.path === 'string' ? result.path : JSON.stringify(result.path);
    const startLine = typeof result.startLine === 'number' ? result.startLine : undefined;
    const endLine = typeof result.endLine === 'number' ? result.endLine : undefined;
    const range = startLine !== undefined && endLine !== undefined
      ? ` (${startLine}-${endLine})`
      : '';
    return [
      `File: ${pathLabel}`,
      `Scope: ${isFullFile ? 'full-file' : 'partial-slice'}${range}`,
      '',
      result.content,
    ].join('\n');
  }

  async execute(
    params: FsReadParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsReadResult>> {
    const { filePath, offset = 1, limit = READ_DEFAULT_LIMIT } = params;
    try {
      // Human slash commands are workspace-wide reads. Agent/tool calls keep
      // the active context's normal fs-context permissions.
      const basePermissions = context.agent?.permissions ?? { read: [], write: [], list: [] };
      const permissions = context.invocationSurface === 'slash'
        ? { ...basePermissions, read: ['**'], list: ['**'] }
        : basePermissions;
      const fs = await this.workspaceFsFactory.create(
        context.agent?.id ?? '',
        permissions
      );
      const result = await fs.readFile(filePath, {
        offset,
        limit,
        workspaceRoot: this.workspaceRoot,
      });
      return {
        status: 'ok',
        data: await mapReadResult(
          result,
          filePath,
          context.agent?.id ?? '',
          fs,
          async () => {
            const entries = await listCachedWorkspaceFiles(this.workspaceRoot);
            const allFiles = entries.map((e) => e.relativePath);
            return this.fuzzyFileSearch.findSimilar(filePath, permissions, allFiles);
          }
        ),
      };
    } catch (e) {
      const data = failed(e, filePath, 'content');
      return {
        status: 'error',
        error: { message: data.error ?? 'Read failed' },
        data,
      };
    }
  }
}
