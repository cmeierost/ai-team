import { z } from 'zod';
import { READ_DEFAULT_LIMIT } from 'fs-context';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IWorkspaceFsFactory,
} from '@ai-team/core';
import { mapReadResult, failed } from './fs-tools-helpers.js';
import type { FsReadParams, FsReadResult } from './fs-tool-types.js';

export class FsReadFileTool implements ICommand<FsReadParams, FsReadResult> {
  readonly name = 'read';
  readonly key = 'read';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = [
    'Read a file through access checks with structured access metadata.',
    'Reads line-by-line internally (never buffers the whole file into memory).',
    'Supports pagination via `offset` (1-based start line) and `limit` (max lines).',
    'Text content is returned without inline line-number prefixes.',
    'Structured results include `startLine`, `endLine`, and `isFullFile` so callers know which slice was returned.',
    'Lines longer than 2000 chars are truncated; output is capped at 50 KB.',
    'If the file is not found, suggests similar filenames the agent can access.',
    'If the path is a directory, returns a paginated listing (supports offset/limit).',
    'Image files and PDFs are returned as base64 data with their MIME type.',
    'Binary files are detected and a notice is returned instead of raw bytes.',
    'Tracking: records read time so fs_edit can validate staleness.',
  ].join(' ');
  readonly parameters = z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    offset: z.number().int().min(1).optional().describe('1-based line to start from (default 1)'),
    limit: z.number().int().min(1).optional().describe('Max lines to return (default 2000)'),
  });

  constructor(
    private readonly workspaceRoot: string,
    private readonly workspaceFsFactory: IWorkspaceFsFactory
  ) {}

  formatForLlm(result: FsReadResult): unknown {
    if (typeof result.content !== 'string') return result;
    const isFullFile = result.isFullFile === true;
    const pathLabel = typeof result.path === 'string' ? result.path : JSON.stringify(result.path);
    return [
      `File: ${pathLabel}`,
      `Scope: ${isFullFile ? 'full-file' : 'partial-slice'}`,
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
      const fs = await this.workspaceFsFactory.create(
        context.agent?.id ?? '',
        context.agent?.permissions ?? { read: [], write: [], list: [] }
      );
      const result = await fs.readFile(filePath, {
        offset,
        limit,
        workspaceRoot: this.workspaceRoot,
      });
      return {
        status: 'ok',
        data: mapReadResult(result, filePath, context.agent?.id ?? '', fs),
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
