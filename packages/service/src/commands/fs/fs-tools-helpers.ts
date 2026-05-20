import { FileTime, PermissionError } from 'fs-context';
import type { ReadFileResult } from 'fs-context';
/** Standard denial response when a PermissionError is caught. */
export function denied(e: PermissionError, inputPath: string, resultKey: string) {
  return {
    path: inputPath,
    [resultKey]: false,
    error: e.message,
  };
}

/** Standard error response for unexpected failures. */
export function failed(e: unknown, inputPath: string, resultKey: string) {
  if (e instanceof PermissionError) return denied(e, inputPath, resultKey);
  let message: string;
  if (typeof e === 'string') {
    message = e;
  } else if (e instanceof Error) {
    message = e.message;
  } else {
    message = JSON.stringify(e);
  }
  return {
    path: inputPath,
    [resultKey]: false,
    error: message,
  };
}

/** Map a ReadFileResult to the tool response shape. */
export function mapReadResult(
  result: ReadFileResult,
  filePath: string,
  agentId: string,
  fs: { canRead: (path: string) => boolean; toAbsolutePath: (path: string) => string }
): Record<string, unknown> {
  switch (result.kind) {
    case 'not-found': {
      const filtered = result.suggestions.filter((s) => fs.canRead(s)).slice(0, 3);
      const msg =
        filtered.length > 0
          ? `File not found: ${filePath}\n\nDid you mean one of these?\n${filtered.join('\n')}`
          : `File not found: ${filePath}`;
      return { path: filePath, content: null, error: msg };
    }
    case 'directory':
      return {
        path: filePath,
        content: null,
        directory: true,
        listing: result.entries.join('\n'),
        totalEntries: result.totalEntries,
        offset: result.offset,
        limit: result.limit,
        hasMore: result.hasMore,
      };
    case 'media': {
      const label = result.mimeType.startsWith('image/')
        ? 'Image read successfully'
        : 'PDF read successfully';
      return {
        path: filePath,
        content: label,
        mimeType: result.mimeType,
        base64: result.base64,
        sizeBytes: result.sizeBytes,
      };
    }
    case 'binary':
      return { path: filePath, content: null, binary: true, sizeBytes: result.sizeBytes };
    case 'offset-out-of-range': {
      const s = result.totalLines === 1 ? '' : 's';
      return {
        path: filePath,
        content: null,
        error: `Offset ${result.offset} is out of range — file has ${result.totalLines} line${s}.`,
      };
    }
    case 'text': {
      FileTime.record(agentId, fs.toAbsolutePath(filePath));
      return {
        path: filePath,
        content: result.content,
        totalLines: result.totalLines,
        startLine: result.startLine,
        endLine: result.endLine,
        isFullFile: result.isFullFile,
        offset: result.offset,
        limit: result.limit,
        hasMore: result.hasMore,
        ...(result.truncatedByBytes && { truncatedByBytes: true, nextOffset: result.nextOffset }),
        ...(!result.truncatedByBytes && result.hasMore && { nextOffset: result.nextOffset }),
      };
    }
  }
}
