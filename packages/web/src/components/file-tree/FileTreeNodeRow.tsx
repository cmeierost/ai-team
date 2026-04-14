import { useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { fileIcon } from './fileTreeUtils';
import type { PatternMode, TreeNode } from './fileTreeTypes';

interface FileTreeNodeRowProps {
  node: TreeNode;
  depth: number;
  editMode: boolean;
  highlightedPaths?: ReadonlySet<string>;
  pendingPaths: Set<string>;
  onToggle: (path: string, mode: PatternMode, current: boolean) => void;
}

interface FilePermissionsProps {
  path: string;
  editMode: boolean;
  isPending: boolean;
  readable: boolean;
  listable: boolean;
  writable: boolean;
  onToggle: (path: string, mode: PatternMode, current: boolean) => void;
}

async function openFileInIde(client: ReturnType<typeof useTeam>['client'], relativePath: string) {
  try {
    await client.ide.openFile({ filePath: relativePath });
  } catch {
    // IDE bridge may not be connected.
  }
}

function FileTreeRowAction({
  node,
  isDirectory,
  editMode,
  open,
  onToggleOpen,
}: Readonly<{
  node: TreeNode;
  isDirectory: boolean;
  editMode: boolean;
  open: boolean;
  onToggleOpen: () => void;
}>) {
  const { client } = useTeam();
  if (isDirectory) {
    return (
      <button
        className="ft-expand"
        onClick={onToggleOpen}
        aria-label={open ? 'Collapse' : 'Expand'}
      >
        <i className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
      </button>
    );
  }

  if (editMode) {
    return <span className="ft-expand ft-expand-spacer" />;
  }

  return (
    <button
      className="ft-expand ft-open-btn"
      onClick={() => void openFileInIde(client, node.path)}
      title="Open in IDE"
      aria-label="Open in IDE"
    >
      <i className="codicon codicon-go-to-file" />
    </button>
  );
}

function FileTreeRowName({
  node,
  isDirectory,
  editMode,
}: Readonly<{ node: TreeNode; isDirectory: boolean; editMode: boolean }>) {
  const { client } = useTeam();
  if (isDirectory || editMode) {
    return (
      <span className="ft-name" title={node.path}>
        {node.name}
      </span>
    );
  }

  return (
    <button
      className="ft-name ft-name-link"
      title={`Open in IDE: ${node.path}`}
      onClick={() => void openFileInIde(client, node.path)}
    >
      {node.name}
    </button>
  );
}

function FilePermissions({
  path,
  editMode,
  isPending,
  readable,
  listable,
  writable,
  onToggle,
}: Readonly<FilePermissionsProps>) {
  if (!editMode) {
    return (
      <div className="ft-perms">
        {listable ? (
          <span className="ft-badge ft-badge-list" title="Listable">
            L
          </span>
        ) : null}
        {readable ? (
          <span className="ft-badge ft-badge-read" title="Readable">
            R
          </span>
        ) : null}
        {writable ? (
          <span className="ft-badge ft-badge-write" title="Writable">
            W
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="ft-perms">
      <button
        type="button"
        className={`ft-perm-btn ${listable ? 'ft-perm-on' : 'ft-perm-off'}`}
        title={listable ? 'Revoke list access' : 'Grant list access'}
        disabled={isPending}
        onClick={() => onToggle(path, 'list', listable)}
      >
        <i className="codicon codicon-list-tree" /> L
      </button>
      <button
        type="button"
        className={`ft-perm-btn ${readable ? 'ft-perm-on' : 'ft-perm-off'}`}
        title={readable ? 'Revoke read access' : 'Grant read access'}
        disabled={isPending}
        onClick={() => onToggle(path, 'read', readable)}
      >
        <i className="codicon codicon-eye" /> R
      </button>
      <button
        type="button"
        className={`ft-perm-btn ${writable ? 'ft-perm-on' : 'ft-perm-off'}`}
        title={writable ? 'Revoke write access' : 'Grant write access'}
        disabled={isPending}
        onClick={() => onToggle(path, 'write', writable)}
      >
        <i className="codicon codicon-edit" /> W
      </button>
    </div>
  );
}

export function FileTreeNodeRow({
  node,
  depth,
  editMode,
  highlightedPaths,
  pendingPaths,
  onToggle,
}: Readonly<FileTreeNodeRowProps>) {
  const [open, setOpen] = useState(depth < 2);
  const file = node.file;
  const isDirectory = node.isDir;
  const readable = file?.readable ?? false;
  const listable = file?.listable ?? false;
  const writable = file?.writable ?? false;
  const isHighlighted = !isDirectory && Boolean(file && highlightedPaths?.has(file.path));
  const isPending = pendingPaths.has(node.path);

  return (
    <>
      <div
        className={`ft-row ft-depth-${Math.min(depth, 8)} ${isDirectory ? 'ft-dir' : 'ft-file'} ${isPending ? 'ft-pending' : ''} ${isHighlighted ? 'ft-shared' : ''}`}
      >
        <FileTreeRowAction
          node={node}
          isDirectory={isDirectory}
          editMode={editMode}
          open={open}
          onToggleOpen={() => setOpen((current) => !current)}
        />

        <span className="ft-icon">{fileIcon(node.name, isDirectory)}</span>
        <FileTreeRowName node={node} isDirectory={isDirectory} editMode={editMode} />

        {isDirectory ? null : (
          <FilePermissions
            path={node.path}
            editMode={editMode}
            isPending={isPending}
            readable={readable}
            listable={listable}
            writable={writable}
            onToggle={onToggle}
          />
        )}
      </div>

      {isDirectory && open
        ? node.children.map((child) => (
            <FileTreeNodeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              editMode={editMode}
              highlightedPaths={highlightedPaths}
              pendingPaths={pendingPaths}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  );
}
