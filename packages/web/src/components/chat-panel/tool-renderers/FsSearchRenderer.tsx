import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import { registerRenderer } from './registry';

interface SearchMatch {
  path?: string;
  name?: string;
  line?: number;
  lines?: number[];
  content?: string;
  snippet?: string;
  snippets?: Array<{ line: number; content: string }>;
}

function renderSearch(result: unknown, _resultLlm: unknown, _event: SessionActivatedTool): ReactNode {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const matches: SearchMatch[] = Array.isArray(r.results)
    ? (r.results as SearchMatch[])
    : Array.isArray(r.matches)
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
          {match.lines?.map((line) => <span key={line} className="tc-meta">:{line}</span>)}
          {match.snippets?.map((snippet) => (
            <div key={snippet.line} className="tc-search-content">
              <span className="tc-meta">:{snippet.line} </span>{snippet.content}
            </div>
          ))}
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

registerRenderer({ toolName: 'fs_search', render: renderSearch });
