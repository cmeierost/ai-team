import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import { registerRenderer } from './registry';

interface TreeNode {
  name?: string;
  isDirectory?: boolean;
  children?: TreeNode[];
  rights?: {
    l?: boolean;
    r?: boolean;
    w?: boolean;
  };
}

function renderRights(node: TreeNode): ReactNode {
  const rights = node.rights;
  if (!rights) return null;

  return (
    <span className="tc-tree-rights" aria-label="permissions">
      {rights.l ? (
        <span className="tc-tree-right tc-tree-right--list" title="Listable">
          L
        </span>
      ) : null}
      {rights.r ? (
        <span className="tc-tree-right tc-tree-right--read" title="Readable">
          R
        </span>
      ) : null}
      {rights.w ? (
        <span className="tc-tree-right tc-tree-right--write" title="Writable">
          W
        </span>
      ) : null}
    </span>
  );
}

function renderNode(node: TreeNode, depth: number, idx: string): ReactNode {
  const icon = node.isDirectory ? '📁' : '📄';
  const label = (
    <>
      <span>{icon}</span>
      <span>{node.name ?? '…'}</span>
      {renderRights(node)}
    </>
  );

  if (node.isDirectory) {
    return (
      <details key={idx} className="tc-tree-node-details" open={depth < 2}>
        <summary className="tc-tree-node-summary">{label}</summary>
        <div className="tc-tree-children">
          {node.children?.map((child, i) => renderNode(child, depth + 1, `${idx}-${i}`))}
        </div>
      </details>
    );
  }

  return (
    <div key={idx} className="tc-tree-node tc-tree-node--file">
      {label}
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
