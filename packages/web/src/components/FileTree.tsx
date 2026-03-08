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
import type { AgentFilesResponse, FilePatternsResponse } from '../types';
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

async function openFileInIde(relativePath: string) {
  try {
    await fetch(`${API_BASE}/api/ide/open-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: relativePath }),
    });
  } catch {
    // silent — IDE may not be connected
  }
}

function NodeRow({ node, depth, editMode, pendingPaths, onToggle }: Readonly<NodeRowProps>) {
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
        ) : !editMode ? (
          <button
            className="ft-expand ft-open-btn"
            onClick={() => openFileInIde(node.path)}
            title="Open in IDE"
            aria-label="Open in IDE"
          >
            <i className="codicon codicon-go-to-file" />
          </button>
        ) : (
          <span className="ft-expand ft-expand-spacer" />
        )}

        <span className="ft-icon">{fileIcon(node.name, node.isDir)}</span>
        {!node.isDir && !editMode ? (
          <button
            className="ft-name ft-name-link"
            title={`Open in IDE: ${node.path}`}
            onClick={() => openFileInIde(node.path)}
          >
            {node.name}
          </button>
        ) : (
          <span className="ft-name" title={node.path}>{node.name}</span>
        )}

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

export function FileTree({ agentId, editMode }: Readonly<FileTreeProps>) {
  const [data, setData] = useState<AgentFilesResponse | null>(null);
  const [patterns, setPatterns] = useState<FilePatternsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(new Set());
  const [pendingPatternKey, setPendingPatternKey] = useState<string | null>(null);
  const [patternScope, setPatternScope] = useState<'agent' | 'global'>('agent');
  const [patternMode, setPatternMode] = useState<'read' | 'write'>('read');
  const [patternInput, setPatternInput] = useState('');
  const [filter, setFilter] = useState<'all' | 'read' | 'write'>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [filesRes, patternsRes] = await Promise.all([
        fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}/files?all=true`),
        fetch(`${API_BASE}/api/files/patterns?agent=${encodeURIComponent(agentId)}`),
      ]);
      if (!filesRes.ok) throw new Error(`HTTP ${filesRes.status}`);
      if (!patternsRes.ok) throw new Error(`HTTP ${patternsRes.status}`);
      const filesJson: AgentFilesResponse = await filesRes.json();
      const patternsJson: FilePatternsResponse = await patternsRes.json();
      setData(filesJson);
      setPatterns(patternsJson);
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

  const addPattern = useCallback(async () => {
    const value = patternInput.trim();
    if (!value) return;

    const key = `add:${patternScope}:${patternMode}:${value}`;
    setPendingPatternKey(key);
    setError(null);
    try {
      const url = patternScope === 'agent'
        ? `${API_BASE}/api/files/agents/${encodeURIComponent(agentId)}/allow`
        : `${API_BASE}/api/files/allow`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: value, mode: patternMode }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      setPatternInput('');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to add pattern');
    } finally {
      setPendingPatternKey(null);
    }
  }, [agentId, load, patternInput, patternMode, patternScope]);

  const removePattern = useCallback(async (scope: 'agent' | 'global', mode: 'read' | 'write', value: string) => {
    const key = `remove:${scope}:${mode}:${value}`;
    setPendingPatternKey(key);
    setError(null);
    try {
      const url = scope === 'agent'
        ? `${API_BASE}/api/files/agents/${encodeURIComponent(agentId)}/allow`
        : `${API_BASE}/api/files/allow`;

      const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: value, mode }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to remove pattern');
    } finally {
      setPendingPatternKey(null);
    }
  }, [agentId, load]);

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
  const agentReadPatterns = patterns?.agent?.readPaths ?? data?.readPatterns ?? [];
  const agentWritePatterns = patterns?.agent?.writePaths ?? data?.writePatterns ?? [];
  const globalReadPatterns = patterns?.global.readPaths ?? [];
  const globalWritePatterns = patterns?.global.writePaths ?? [];

  const visiblePatternGroups = [
    { label: 'Agent Read', scope: 'agent' as const, mode: 'read' as const, values: agentReadPatterns },
    { label: 'Agent Write', scope: 'agent' as const, mode: 'write' as const, values: agentWritePatterns },
    { label: 'Global Read', scope: 'global' as const, mode: 'read' as const, values: globalReadPatterns },
    { label: 'Global Write', scope: 'global' as const, mode: 'write' as const, values: globalWritePatterns },
  ].filter((group) => group.values.length > 0);

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
              {visiblePatternGroups.map((group) => (
                <div key={`${group.scope}-${group.mode}`} className="ft-pattern-group">
                  <span className="ft-pattern-group-label">{group.label}</span>
                  {group.values.map((p) => (
                    <span key={`${group.scope}-${group.mode}-${p}`} className={`ft-pattern ${group.mode === 'read' ? 'ft-pattern-read' : 'ft-pattern-write'}`}>
                      {p}
                      {editMode && (
                        <button
                          type="button"
                          className="ft-pattern-remove"
                          onClick={() => removePattern(group.scope, group.mode, p)}
                          disabled={pendingPatternKey === `remove:${group.scope}:${group.mode}:${p}`}
                          title="Remove pattern"
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {editMode && (
        <div className="ft-pattern-editor">
          <div className="ft-pattern-editor-controls">
            <select
              className="ft-pattern-select"
              value={patternScope}
              title="Pattern scope"
              aria-label="Pattern scope"
              onChange={(e) => setPatternScope(e.target.value as 'agent' | 'global')}
            >
              <option value="agent">Agent</option>
              <option value="global">Global</option>
            </select>
            <select
              className="ft-pattern-select"
              value={patternMode}
              title="Pattern mode"
              aria-label="Pattern mode"
              onChange={(e) => setPatternMode(e.target.value as 'read' | 'write')}
            >
              <option value="read">Read</option>
              <option value="write">Write</option>
            </select>
            <input
              className="ft-pattern-input"
              placeholder="Pattern (e.g. src/**/*.ts)"
              value={patternInput}
              onChange={(e) => setPatternInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addPattern();
                }
              }}
            />
            <button
              type="button"
              className="ft-pattern-add"
              disabled={pendingPatternKey?.startsWith('add:') || !patternInput.trim()}
              onClick={() => void addPattern()}
            >
              Add pattern
            </button>
          </div>
        </div>
      )}

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
