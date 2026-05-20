import fs from 'node:fs/promises';
import { z } from 'zod';
import { FileTime, fuzzyReplace, emitFileEdited } from 'fs-context';
import type {
  ExecutionContext,
  ICommand,
  CommandResponse,
  IPathPermissionChecker,
  IIdeAdapterFactory,
  LspProvider,
} from '@ai-team/core';
import { resolveFsAbsolutePath, toFsPathAccessEnvelope, toFsPathMeta } from './fs-access.js';
import { collectPostWriteDiagnostics } from '../../tools/catalog/diagnostics-helper.js';
import { stripLineNumberPrefixes } from './fs-edit-helpers.js';

export interface FsEditParams {
  filePath: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
}

export class FsEditTool implements ICommand<FsEditParams, unknown> {
  readonly name = 'edit';
  readonly key = 'edit';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = [
    'Perform a surgical in-place edit of a file by replacing an exact string.',
    'REQUIRES the file to have been read first with read in the same session.',
    'The edit will fail if the file has been modified on disk since the last read.',
    'Use `replaceAll: true` to replace every occurrence; default replaces only the first.',
    'Always read the file with `read` immediately before calling this tool.',
  ].join(' ');
  readonly parameters = z.object({
    filePath: z.string().describe('Relative or absolute path to the file to edit'),
    oldString: z
      .string()
      .min(1)
      .describe('Exact string to find and replace (must be unique unless replaceAll is true)'),
    newString: z.string().describe('Replacement string'),
    replaceAll: z
      .boolean()
      .optional()
      .describe('Replace all occurrences (default: false — first only)'),
  });

  formatForLlm(result: unknown): unknown {
    const inner = (result as { data?: unknown })?.data ?? result;
    const r = inner as { path?: Record<string, string>; edited: boolean; error?: string };
    const filePath = r.path?.['relative'] ?? '';
    if (r.edited) return `Edited: ${filePath}`;
    return `Not edited: ${filePath}${r.error ? ' — ' + r.error : ''}`;
  }

  constructor(
    private readonly workspaceRoot: string,
    private readonly pathPermissionChecker: IPathPermissionChecker,
    private readonly ideAdapterFactory: IIdeAdapterFactory
  ) {}

  private async resolveLsp(context: ExecutionContext): Promise<LspProvider> {
    const channel = context.invocationSurface === 'cli' ? 'cli' : 'web';
    const adapter = await this.ideAdapterFactory.createAsync(this.workspaceRoot, channel);
    return adapter.lsp;
  }

  async execute(
    params: FsEditParams,
    context: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const { filePath, replaceAll = false } = params;

    const cleanOld = stripLineNumberPrefixes(params.oldString);
    const cleanNew = stripLineNumberPrefixes(params.newString);
    const oldString = cleanOld.text;
    const newString = cleanNew.text;

    const absolutePath = resolveFsAbsolutePath(this.workspaceRoot, filePath);
    if (!absolutePath) {
      return {
        status: 'error',
        error: { message: 'Path is outside workspace root.' },
        data: {
          path: { input: filePath, absolute: '', relative: '' },
          edited: false,
          access: {
            allowed: false,
            explanation: 'Path is outside workspace root.',
            alternativeContexts: [],
          },
        },
      };
    }

    const pathMeta = toFsPathMeta(this.workspaceRoot, filePath, absolutePath);
    const access = toFsPathAccessEnvelope(
      this.pathPermissionChecker,
      context.agent,
      'edit',
      filePath
    );
    if (!access.allowed) {
      return {
        status: 'error',
        error: { message: access.explanation },
        data: {
          path: pathMeta,
          edited: false,
          access,
          delegation: {
            possible: access.alternativeContexts.length > 0,
            contexts: access.alternativeContexts,
            unassignable: access.alternativeContexts.length === 0,
          },
        },
      };
    }

    return FileTime.withLock(absolutePath, async (): Promise<CommandResponse<unknown>> => {
      return this.applyEditWithLock({
        params,
        context,
        access,
        pathMeta,
        absolutePath,
        oldString,
        newString,
        replaceAll,
      });
    });
  }

  private async applyEditWithLock(args: {
    params: FsEditParams;
    context: ExecutionContext;
    access: ReturnType<typeof toFsPathAccessEnvelope>;
    pathMeta: ReturnType<typeof toFsPathMeta>;
    absolutePath: string;
    oldString: string;
    newString: string;
    replaceAll: boolean;
  }): Promise<CommandResponse<unknown>> {
    const { context, access, pathMeta, absolutePath, oldString, newString, replaceAll } = args;
    const agent = context.agent;
    if (!agent) {
      return {
        status: 'error',
        error: { message: 'No agent in execution context.' },
        data: { path: pathMeta, edited: false, error: 'No agent in context.', access },
      };
    }

    const fileTimeError = await this.assertFileTime(agent.id, absolutePath, pathMeta, access);
    if (fileTimeError) return fileTimeError;

    const contentResult = await this.readContent(absolutePath, pathMeta, access);
    if ('error' in contentResult) return contentResult.error;
    const content = contentResult.content;

    const validationError = this.validateReplacement(
      content,
      oldString,
      replaceAll,
      pathMeta,
      access
    );
    if (validationError) return validationError;

    const replaceResult = this.applyReplacement(
      content,
      oldString,
      newString,
      replaceAll,
      pathMeta,
      access
    );
    if ('error' in replaceResult) return replaceResult.error;

    const updated = replaceResult.updated;
    const writeError = await this.writeContent(absolutePath, updated, pathMeta, access);
    if (writeError) return writeError;

    FileTime.record(agent.id, absolutePath);
    emitFileEdited(absolutePath);

    const addedLines = newString.split('\n').length - oldString.split('\n').length;
    const totalBefore = content.split('\n').length;

    const lsp = await this.resolveLsp(context);
    const diagnostics = await collectPostWriteDiagnostics(lsp, [absolutePath]);

    return {
      status: 'ok',
      data: {
        path: pathMeta,
        edited: true,
        replacements: replaceResult.replacements,
        ...(replaceResult.stage === 'exact' ? {} : { matchStage: replaceResult.stage }),
        linesChanged: addedLines,
        totalLines: totalBefore + addedLines,
        access,
        ...(diagnostics ? { diagnostics } : {}),
      },
      _fileChanges: [{ filePath: absolutePath, oldContent: content, newContent: updated }],
    } as CommandResponse<unknown>;
  }

  private async assertFileTime(
    agentId: string,
    absolutePath: string,
    pathMeta: ReturnType<typeof toFsPathMeta>,
    access: ReturnType<typeof toFsPathAccessEnvelope>
  ): Promise<CommandResponse<unknown> | null> {
    try {
      await FileTime.assert(agentId, absolutePath);
      return null;
    } catch (assertErr) {
      const msg = assertErr instanceof Error ? assertErr.message : String(assertErr);
      return {
        status: 'error',
        error: { message: msg },
        data: {
          path: pathMeta,
          edited: false,
          error: msg,
          hint: 'Call read on this file before calling edit.',
          access,
        },
      };
    }
  }

  private async readContent(
    absolutePath: string,
    pathMeta: ReturnType<typeof toFsPathMeta>,
    access: ReturnType<typeof toFsPathAccessEnvelope>
  ): Promise<{ content: string } | { error: CommandResponse<unknown> }> {
    try {
      const content = await fs.readFile(absolutePath, 'utf8');
      return { content };
    } catch (readErr) {
      const msg = readErr instanceof Error ? readErr.message : String(readErr);
      return {
        error: {
          status: 'error',
          error: { message: msg },
          data: { path: pathMeta, edited: false, error: msg, access },
        },
      };
    }
  }

  private validateReplacement(
    content: string,
    oldString: string,
    replaceAll: boolean,
    pathMeta: ReturnType<typeof toFsPathMeta>,
    access: ReturnType<typeof toFsPathAccessEnvelope>
  ): CommandResponse<unknown> | null {
    const exactCount = content.split(oldString).length - 1;
    if (!replaceAll && exactCount > 1) {
      const msg = `oldString appears ${exactCount} times in ${pathMeta.relative}. Provide a more unique string or set replaceAll: true.`;
      return {
        status: 'error',
        error: { message: msg },
        data: { path: pathMeta, edited: false, error: msg, access },
      };
    }
    return null;
  }

  private applyReplacement(
    content: string,
    oldString: string,
    newString: string,
    replaceAll: boolean,
    pathMeta: ReturnType<typeof toFsPathMeta>,
    access: ReturnType<typeof toFsPathAccessEnvelope>
  ):
    | { updated: string; replacements: number; stage: string }
    | { error: CommandResponse<unknown> } {
    const fuzzyResult = fuzzyReplace(content, oldString, newString, replaceAll);
    if (!fuzzyResult) {
      const msg = `oldString not found in ${pathMeta.relative}`;
      return {
        error: {
          status: 'error',
          error: { message: msg },
          data: {
            path: pathMeta,
            edited: false,
            error: msg,
            hint: 'Use read to verify the current content of the file before calling edit.',
            access,
          },
        },
      };
    }

    return {
      updated: fuzzyResult.content,
      replacements: fuzzyResult.replacements,
      stage: fuzzyResult.stage,
    };
  }

  private async writeContent(
    absolutePath: string,
    updated: string,
    pathMeta: ReturnType<typeof toFsPathMeta>,
    access: ReturnType<typeof toFsPathAccessEnvelope>
  ): Promise<CommandResponse<unknown> | null> {
    try {
      await fs.writeFile(absolutePath, updated, 'utf8');
      return null;
    } catch (writeErr) {
      const msg = writeErr instanceof Error ? writeErr.message : String(writeErr);
      return {
        status: 'error',
        error: { message: msg },
        data: { path: pathMeta, edited: false, error: msg, access },
      };
    }
  }
}
