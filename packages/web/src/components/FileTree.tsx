/**
 * FileTree component — shows workspace files annotated with an agent's read/write
 * permissions. In view mode, shows which files are readable/writable. In edit mode,
 * allows toggling read and write access per file.
 *
 * API used:
 *   GET  /api/agents/:id/files?all=true      → AgentFilesResponse
 *   POST /api/files/agents/:id/allow         { path, mode }
 *   DELETE /api/files/agents/:id/allow       { path, mode }
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { API_BASE } from '../context/TeamContext';
import type { AnnotatedFile, AgentFilesResponse } from '../types';
import './FileTree.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlatFile {
  path: string;      // workspace-relative
  readable: boolean;
  writable: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  file?: FlatFile;   // leaf only
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildTree(files: FlatFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };

  for (const file of files) {
    const parts = file.path.replace(/\\/g, '/').split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        const partPath = parts.slice(0, i + 1).join('/');
        child = { name: part, path: partPath, isDir: !isLast, children: [] };
        if (isLast) child.file = file;
        node.children.push(child);
      }
      node = child;
    }
  }

  // Sort: dirs first, then files, alphabetically
  function sortChildren(n: TreeNode) {
    n.children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    n.children.forEach(sortChildren);
  }
  sortChildren(root);

  return root.children;
}

function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

const EXT_ICON: Record<string, string> = {
  ts: '𝘛',  tsx: '⚛',  js: '𝙅',  jsx: '⚛',
  json: '{}', md: '📄',  css: '🎨', html: '🌐',
  yml: '⚙',  yaml: '⚙', sh: '⚡',  env: '🔑',
};

function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return '📁';
  return EXT_ICON[getExt(name)] ?? '📄';
}

// ─── Tree Node Row ────────────────────────────────────────────────────────────

interface NodeRowProps {
  node: TreeNode;
  depth: number;
  editMode: boolean;
  pendingPaths: Set<string>;
  onToggle: (path: string, mode: 'read' | 'write', current: boolean) => void;
}

function NodeRow({ node, depth, editMode, pendingPaths, onToggle }: NodeRowProps) {
  const [open, setOpen] = useState(depth < 2);

  const file = node.file;
  const readable = file?.readable ?? false;
  const writable = file?.writable ?? false;
  const isPending = pendingPaths.has(node.path);

  return (
    <>
      <div
        className={`ft-row ft-depth-${Math.min(depth, 8)} ${node.isDir ? 'ft-dir' : 'ft-file'} ${isPending ? 'ft-pending' : ''}`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {node.isDir ? (
          <button
            className="ft-expand"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Collapse' : 'Expand'}
          >
            <i className={`codicon codicon-chevron-${open ? 'down' : 'right'}`} />
          </button>
        ) : (
          <span className="ft-expand ft-expand-spacer" />
        )}

        <span className="ft-icon">{fileIcon(node.name, node.isDir)}</span>
        <span className="ft-name" title={node.path}>{node.name}</span>

        {!node.isDir && (
          <div className="ft-perms">
            {editMode ? (
              <>
                <button
                  type="button"
                  className={`ft-perm-btn ${readable ? 'ft-perm-on' : 'ft-perm-off'}`}
                  title={readable ? 'Revoke read access' : 'Grant read access'}
                  disabled={isPending}
                  onClick={() => onToggle(node.path, 'read', readable)}
                >
                  <i className="codicon codicon-eye" /> R
                </button>
                <button
                  type="button"
                  className={`ft-perm-btn ${writable ? 'ft-perm-on' : 'ft-perm-off'}`}
                  title={writable ? 'Revoke write access' : 'Grant write access'}
                  disabled={isPending}
                  onClick={() => onToggle(node.path, 'write', writable)}
                >
                  <i className="codicon codicon-edit" /> W
                </button>
              </>
            ) : (
              <>
                {readable && <span className="ft-badge ft-badge-read" title="Readable">R</span>}
                {writable && <span className="ft-badge ft-badge-write" title="Writable">W</span>}
              </>
            )}
          </div>
        )}
      </div>

      {node.isDir && open && node.children.map((child) => (
        <NodeRow
          key={child.path}
          node={child}
          depth={depth + 1}
          editMode={editMode}
          pendingPaths={pendingPaths}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface FileTreeProps {
  agentId: string;
  editMode: boolean;
}

export function FileTree({ agentId, editMode }: FileTreeProps) {
  const [data, setData] = useState<AgentFilesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'read' | 'write'>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}/files?all=true`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: AgentFilesResponse = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e?.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { load(); }, [load]);

  const handleToggle = useCallback(async (path: string, mode: 'read' | 'write', current: boolean) => {
    setPendingPaths((s) => new Set([...s, path]));
    try {
      const method = current ? 'DELETE' : 'POST';
      const res = await fetch(`${API_BASE}/api/files/agents/${encodeURIComponent(agentId)}/allow`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, mode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      // Optimistically update local state
      setData((prev) => {
        if (!prev) return prev;
        const files = prev.files.map((f) => {
          if (f.path !== path) return f;
          return {
            ...f,
            readable: mode === 'read' ? !current : f.readable,
            writable: mode === 'write' ? !current : f.writable,
          };
        });
        return { ...prev, files };
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to update permission');
    } finally {
      setPendingPaths((s) => { const n = new Set(s); n.delete(path); return n; });
    }
  }, [agentId]);

  const filteredFiles = useMemo<FlatFile[]>(() => {
    if (!data) return [];
    return data.files
      .filter((f) => {
        if (filter === 'read' && !f.readable) return false;
        if (filter === 'write' && !f.writable) return false;
        if (search) return f.path.toLowerCase().includes(search.toLowerCase());
        return true;
      })
      .map((f) => ({ path: f.path, readable: f.readable, writable: f.writable }));
  }, [data, filter, search]);

  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles]);

  const readCount = data?.files.filter((f) => f.readable).length ?? 0;
  const writeCount = data?.files.filter((f) => f.writable).length ?? 0;

  if (loading) return (
    <div className="ft-loading">
      <i className="codicon codicon-loading codicon-modifier-spin" /> Loading file tree…
    </div>
  );

  if (error) return (
    <div className="ft-error">
      <i className="codicon codicon-error" /> {error}
      <button className="ft-retry" onClick={load}>Retry</button>
    </div>
  );

  if (!data) return null;

  return (
    <div className="ft-root">
      {/* Summary row */}
      <div className="ft-summary">
        <span className="ft-summary-item ft-summary-read">
          <i className="codicon codicon-eye" /> {readCount} readable
        </span>
        <span className="ft-summary-item ft-summary-write">
          <i className="codicon codicon-edit" /> {writeCount} writable
        </span>
        {data.readPatterns.length > 0 && (
          <details className="ft-patterns">
            <summary>Patterns</summary>
            <div className="ft-pattern-list">
              {data.readPatterns.map((p) => <span key={p} className="ft-pattern ft-pattern-read">{p}</span>)}
              {data.writePatterns.map((p) => <span key={p} className="ft-pattern ft-pattern-write">{p}</span>)}
            </div>
          </details>
        )}
      </div>

      {/* Toolbar */}
      <div className="ft-toolbar">
        <input
          className="ft-search"
          placeholder="Filter files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="ft-filter-group">
          {(['all', 'read', 'write'] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`ft-filter-btn ${filter === v ? 'ft-filter-active' : ''}`}
              onClick={() => setFilter(v)}
            >
              {v === 'all' ? 'All' : v === 'read' ? <><i className="codicon codicon-eye" /> Read</> : <><i className="codicon codicon-edit" /> Write</>}
            </button>
          ))}
        </div>
      </div>

      {/* Tree */}
      <div className="ft-tree">
        {tree.length === 0 ? (
          <p className="ft-empty">
            {filter !== 'all' || search
              ? 'No files match the current filter.'
              : 'No files accessible.'}
          </p>
        ) : (
          tree.map((node) => (
            <NodeRow
              key={node.path}
              node={node}
              depth={0}
              editMode={editMode}
              pendingPaths={pendingPaths}
              onToggle={handleToggle}
            />
          ))
        )}
      </div>
    </div>
  );
}
