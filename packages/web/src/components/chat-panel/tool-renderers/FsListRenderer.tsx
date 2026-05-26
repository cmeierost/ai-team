import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import { registerRenderer } from './registry';

interface FsEntry {
  name?: string;
  isDirectory?: boolean;
}

function extractEntries(result: unknown): FsEntry[] | null {
  if (Array.isArray(result)) return result as FsEntry[];
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (Array.isArray(r.entries)) return r.entries as FsEntry[];
    if (Array.isArray(r.items)) return r.items as FsEntry[];
  }
  return null;
}

registerRenderer({
  toolName: 'fs_list',
  render(result: unknown, _resultLlm: unknown, _event: SessionActivatedTool): ReactNode {
    const entries = extractEntries(result);
    if (!entries) return null;
    return (
      <div className="tc-fs-list">
        {entries.length === 0 ? (
          <span className="tc-muted">Empty directory</span>
        ) : (
          entries.map((entry, i) => (
            <div key={i} className="tc-fs-entry">
              {entry.isDirectory ? '📁' : '📄'} {entry.name ?? '?'}
            </div>
          ))
        )}
      </div>
    );
  },
});
