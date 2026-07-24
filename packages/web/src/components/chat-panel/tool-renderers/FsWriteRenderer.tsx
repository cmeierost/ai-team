import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import { registerRenderer } from './registry';

interface FileChange {
  filePath: string;
  oldContent: string;
  newContent: string;
}

interface DiffRow {
  kind: 'same' | 'add' | 'remove';
  content: string;
  oldLine?: number;
  newLine?: number;
}

export function buildDiffRows(oldContent: string, newContent: string): DiffRow[] {
  const oldLines = oldContent ? oldContent.replaceAll('\r\n', '\n').split('\n') : [];
  const newLines = newContent ? newContent.replaceAll('\r\n', '\n').split('\n') : [];
  const rows: DiffRow[] = [];

  if (oldLines.length * newLines.length > 250_000) {
    return [
      ...oldLines.map((content, index) => ({
        kind: 'remove' as const,
        content,
        oldLine: index + 1,
      })),
      ...newLines.map((content, index) => ({
        kind: 'add' as const,
        content,
        newLine: index + 1,
      })),
    ];
  }

  const lengths = Array.from({ length: oldLines.length + 1 }, () =>
    new Uint32Array(newLines.length + 1)
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex--) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex--) {
      lengths[oldIndex][newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? lengths[oldIndex + 1][newIndex + 1] + 1
          : Math.max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1]);
    }
  }

  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (
      oldIndex < oldLines.length
      && newIndex < newLines.length
      && oldLines[oldIndex] === newLines[newIndex]
    ) {
      rows.push({
        kind: 'same',
        content: oldLines[oldIndex],
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
      });
      oldIndex++;
      newIndex++;
    } else if (
      newIndex < newLines.length
      && (oldIndex === oldLines.length
        || lengths[oldIndex][newIndex + 1] >= lengths[oldIndex + 1][newIndex])
    ) {
      rows.push({ kind: 'add', content: newLines[newIndex], newLine: newIndex + 1 });
      newIndex++;
    } else {
      rows.push({ kind: 'remove', content: oldLines[oldIndex], oldLine: oldIndex + 1 });
      oldIndex++;
    }
  }
  return rows;
}

function renderFsWrite(
  _result: unknown,
  _resultLlm: unknown,
  event: SessionActivatedTool
): ReactNode {
  const resultRecord =
    _result && typeof _result === 'object' ? _result as Record<string, unknown> : undefined;
  const changes = (
    event.toolResult?.fileChanges
    ?? resultRecord?.fileChanges
    ?? resultRecord?._fileChanges
  ) as FileChange[] | undefined;
  if (!changes?.length) return null;

  return (
    <div className="tc-write-diffs">
      {changes.map((change) => {
        const rows = buildDiffRows(change.oldContent ?? '', change.newContent ?? '');
        const additions = rows.filter((row) => row.kind === 'add').length;
        const deletions = rows.filter((row) => row.kind === 'remove').length;
        return (
          <section className="tc-write-diff" key={change.filePath}>
            <header className="tc-write-diff-header">
              <span className="tc-write-diff-path">{change.filePath}</span>
              <span className="tc-write-diff-stats">
                <span className="tc-write-diff-additions">+{additions}</span>
                <span className="tc-write-diff-deletions">−{deletions}</span>
              </span>
            </header>
            <div className="tc-write-diff-body">
              {rows.map((row, index) => (
                <div className={`tc-write-diff-row tc-write-diff-row--${row.kind}`} key={index}>
                  <span className="tc-write-diff-line">{row.oldLine ?? ''}</span>
                  <span className="tc-write-diff-line">{row.newLine ?? ''}</span>
                  <span className="tc-write-diff-marker">
                    {row.kind === 'add' ? '+' : row.kind === 'remove' ? '−' : ' '}
                  </span>
                  <code>{row.content || ' '}</code>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

registerRenderer({ toolName: 'fs_write', render: renderFsWrite });
registerRenderer({ toolName: 'fs_write_file', render: renderFsWrite });
registerRenderer({ toolName: 'fs_create', render: renderFsWrite });
