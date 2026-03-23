import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import { MarkdownMessage } from '../../MarkdownMessage';
import { registerRenderer } from './registry';

registerRenderer({
  toolName: 'fs_read',
  render(result: unknown, _resultLlm: unknown, _event: SessionActivatedTool): ReactNode {
    let path: string | undefined;
    let content: string | undefined;

    if (typeof result === 'string') {
      content = result;
    } else if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      path = typeof r.path === 'string' ? r.path : undefined;
      content = typeof r.content === 'string' ? r.content : undefined;
    }

    if (!content) return null;

    return (
      <div className="tc-fs-read">
        {path && <div className="tc-label">{path}</div>}
        <MarkdownMessage content={content} />
      </div>
    );
  },
});
