import { z } from 'zod';
import type { ExecutionContext, ICommand, CommandResponse } from '@ai-team/core';
import type { FsReadLinesParams, FsReadLinesResult } from './fs-tool-types.js';
import { FsReadFileTool } from './fs-read-file.tool.js';

export class FsReadLinesTool implements ICommand<FsReadLinesParams, FsReadLinesResult> {
  readonly name = 'read_lines';
  readonly key = 'read_lines';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Read a range of raw lines from a file.';
  readonly parameters = z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    startLine: z.number().int().min(1).describe('1-based first line'),
    endLine: z.number().int().min(1).describe('1-based last line (inclusive)'),
  });

  constructor(private readonly readFileTool: FsReadFileTool) {}

  async execute(
    params: FsReadLinesParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsReadLinesResult>> {
    const { filePath, startLine, endLine } = params;
    const result = await this.readFileTool.execute(
      { filePath, offset: startLine, limit: endLine - startLine + 1 },
      context
    );

    const data = result.data as Record<string, unknown> | undefined;
    if (result.status !== 'ok' || data?.error || !data?.content) {
      return result;
    }

    const lines = (data.content as string).split('\n');
    return {
      status: 'ok',
      data: { ...data, lines },
    };
  }
}
