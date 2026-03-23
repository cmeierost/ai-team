import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import { registerRenderer } from './registry';

interface TreeNode {
  name?: string;
  isDirectory?: boolean;
  children?: TreeNode[];
}

function renderNode(node: TreeNode, depth: number, idx: string): ReactNode {
  const pad = '\u00a0\u00a0'.repeat(depth);
  const icon = node.isDirectory ? '📁' : '📄';
  return (
    <div key={idx} className="tc-tree-node">
      <span>{pad}{icon} {node.name ?? '…'}</span>
      {node.children?.map((child, i) => renderNode(child, depth + 1, `${idx}-${i}`))}
    </div>
  );
}

registerRenderer({
  toolName: 'fs_tree',
  render(result: unknown, _resultLlm: unknown, _event: SessionActivatedTool): ReactNode {
    if (!result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    if (!('tree' in r)) return null;
    const path = typeof r.path === 'string' ? r.path : '.';
    const tree = r.tree as TreeNode | null | undefined;
    const denied = typeof r.denied === 'number' ? r.denied : 0;
    return (
      <div className="tc-fs-tree">
        <div className="tc-label">{path}</div>
        {denied > 0 && <div className="tc-warn">{denied} path(s) access denied</div>}
        <div className="tc-tree-body">
          {tree ? renderNode(tree, 0, 'root') : <span className="tc-muted">Empty directory</span>}
        </div>
      </div>
    );
  },
});
