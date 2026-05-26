import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import { registerRenderer } from './registry';

interface SearchMatch {
  path?: string;
  name?: string;
  line?: number;
  content?: string;
  snippet?: string;
}

function renderSearch(result: unknown, _resultLlm: unknown, _event: SessionActivatedTool): ReactNode {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const matches: SearchMatch[] = Array.isArray(r.matches)
    ? (r.matches as SearchMatch[])
    : Array.isArray(result)
      ? (result as SearchMatch[])
      : [];

  if (matches.length === 0) return <div className="tc-muted">No matches found</div>;

  return (
    <div className="tc-search-results">
      {matches.slice(0, 25).map((match, i) => (
        <div key={i} className="tc-search-match">
          <span className="tc-search-path">{match.path ?? match.name ?? '?'}</span>
          {match.line !== undefined && <span className="tc-meta">:{match.line}</span>}
          {(match.content ?? match.snippet) && (
            <div className="tc-search-content">{match.content ?? match.snippet}</div>
          )}
        </div>
      ))}
      {matches.length > 25 && (
        <div className="tc-meta">… and {matches.length - 25} more results</div>
      )}
    </div>
  );
}

for (const toolName of ['fs_search_metadata', 'fs_search_content', 'fs_search']) {
  registerRenderer({ toolName, render: renderSearch });
}
