import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import { MarkdownMessage } from '../../MarkdownMessage';
import { registerRenderer } from './registry';

registerRenderer({
  toolName: 'fs_read',
  render(result: unknown, _resultLlm: unknown, _event: SessionActivatedTool): ReactNode {
    let path: string | undefined;
    let content: string | undefined;
    let lineRange: string | undefined;

    if (typeof result === 'string') {
      content = result;
    } else if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      path = typeof r.path === 'string' ? r.path : undefined;
      content = typeof r.content === 'string' ? r.content : undefined;
      if (typeof r.startLine === 'number' && typeof r.endLine === 'number') {
        lineRange = r.isFullFile
          ? `lines 1\u2013${r.endLine}, full file`
          : `lines ${r.startLine}\u2013${r.endLine}`;
      }
    }

    if (!content) return null;

    return (
      <div className="tc-fs-read">
        {path && (
          <div className="tc-label">
            {path}
            {lineRange && <span className="tc-label-meta">{lineRange}</span>}
          </div>
        )}
        <MarkdownMessage content={content} />
      </div>
    );
  },
});
