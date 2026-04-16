import type {
  FileAccessFilter,
  PatternGroup,
  PatternMode,
  PatternScope,
  TreeNode,
} from './fileTreeTypes';
import { FileTreeNodeRow } from './FileTreeNodeRow';

interface FileTreeViewProps {
  editMode: boolean;
  loading: boolean;
  error: string | null;
  hasData: boolean;
  readCount: number;
  listCount: number;
  writeCount: number;
  patternsOpen: boolean;
  visiblePatternGroups: PatternGroup[];
  pendingPatternKey: string | null;
  patternScope: PatternScope;
  patternMode: PatternMode;
  patternInput: string;
  filter: FileAccessFilter;
  search: string;
  tree: TreeNode[];
  highlightedPaths?: ReadonlySet<string>;
  pendingPaths: Set<string>;
  onRetry: () => void;
  onPatternScopeChange: (scope: PatternScope) => void;
  onPatternModeChange: (mode: PatternMode) => void;
  onPatternInputChange: (value: string) => void;
  onAddPattern: () => void;
  onRemovePattern: (scope: PatternScope, mode: PatternMode, value: string) => void;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: FileAccessFilter) => void;
  onTogglePermission: (path: string, mode: PatternMode, current: boolean) => void;
}

export function FileTreeView({
  editMode,
  loading,
  error,
  hasData,
  readCount,
  listCount,
  writeCount,
  patternsOpen,
  visiblePatternGroups,
  pendingPatternKey,
  patternScope,
  patternMode,
  patternInput,
  filter,
  search,
  tree,
  highlightedPaths,
  pendingPaths,
  onRetry,
  onPatternScopeChange,
  onPatternModeChange,
  onPatternInputChange,
  onAddPattern,
  onRemovePattern,
  onSearchChange,
  onFilterChange,
  onTogglePermission,
}: Readonly<FileTreeViewProps>) {
  const patternClassName = (mode: PatternMode): string => {
    if (mode === 'read') return 'ft-pattern-read';
    if (mode === 'list') return 'ft-pattern-list';
    return 'ft-pattern-write';
  };

  if (loading) {
    return (
      <div className="ft-loading">
        <i className="codicon codicon-loading codicon-modifier-spin" /> Loading file tree…
      </div>
    );
  }

  if (error) {
    return (
      <div className="ft-error">
        <i className="codicon codicon-error" /> {error}
        <button className="ft-retry" onClick={onRetry}>
          Retry
        </button>
      </div>
    );
  }

  if (!hasData) {
    return null;
  }

  return (
    <div className="ft-root">
      <div className="ft-summary">
        <span className="ft-summary-item ft-summary-list">
          <i className="codicon codicon-list-tree" /> {listCount} listable
        </span>
        <span className="ft-summary-item ft-summary-read">
          <i className="codicon codicon-eye" /> {readCount} readable
        </span>
        <span className="ft-summary-item ft-summary-write">
          <i className="codicon codicon-edit" /> {writeCount} writable
        </span>
        {patternsOpen || editMode ? (
          <details className="ft-patterns" open>
            <summary>Patterns</summary>
            <div className="ft-pattern-list">
              {visiblePatternGroups.map((group) => (
                <div key={`${group.scope}-${group.mode}`} className="ft-pattern-group">
                  <span className="ft-pattern-group-label">
                    {group.mode === 'list' ? (
                      <i
                        className="codicon codicon-list-tree ft-summary-list"
                        title={group.label}
                      />
                    ) : group.mode === 'read' ? (
                      <i className="codicon codicon-eye ft-summary-read" title={group.label} />
                    ) : (
                      <i className="codicon codicon-edit ft-summary-write" title={group.label} />
                    )}
                  </span>
                  {group.values.map((value) => (
                    <span
                      key={`${group.scope}-${group.mode}-${value}`}
                      className={`ft-pattern ${patternClassName(group.mode)}${group.isDefault ? ' ft-pattern-default' : ''}`}
                      title={
                        group.isDefault ? 'Default — no explicit pattern configured' : undefined
                      }
                    >
                      {value}
                      {editMode && !group.isDefault ? (
                        <button
                          type="button"
                          className="ft-pattern-remove"
                          onClick={() => onRemovePattern(group.scope, group.mode, value)}
                          disabled={
                            pendingPatternKey === `remove:${group.scope}:${group.mode}:${value}`
                          }
                          title="Remove pattern"
                        >
                          ×
                        </button>
                      ) : null}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      {editMode ? (
        <div className="ft-pattern-editor">
          <div className="ft-pattern-editor-controls">
            <select
              className="ft-pattern-select"
              value={patternScope}
              title="Pattern scope"
              aria-label="Pattern scope"
              onChange={(event) => onPatternScopeChange(event.target.value as PatternScope)}
            >
              <option value="agent">Agent</option>
              <option value="global">Global</option>
            </select>
            <select
              className="ft-pattern-select"
              value={patternMode}
              title="Pattern mode"
              aria-label="Pattern mode"
              onChange={(event) => onPatternModeChange(event.target.value as PatternMode)}
            >
              <option value="list">List</option>
              <option value="read">Read</option>
              <option value="write">Write</option>
            </select>
            <input
              className="ft-pattern-input"
              placeholder="Pattern (e.g. src/**/*.ts)"
              value={patternInput}
              onChange={(event) => onPatternInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onAddPattern();
                }
              }}
            />
            <button
              type="button"
              className="ft-pattern-add"
              disabled={pendingPatternKey?.startsWith('add:') || !patternInput.trim()}
              onClick={onAddPattern}
            >
              Add pattern
            </button>
          </div>
        </div>
      ) : null}

      <div className="ft-toolbar">
        <input
          className="ft-search"
          placeholder="Filter files…"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
        <div className="ft-filter-group">
          {(['all', 'list', 'read', 'write'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`ft-filter-btn ${filter === value ? 'ft-filter-active' : ''}`}
              onClick={() => onFilterChange(value)}
            >
              {value === 'all' ? (
                'All'
              ) : value === 'read' ? (
                <>
                  <i className="codicon codicon-eye" /> Read
                </>
              ) : value === 'list' ? (
                <>
                  <i className="codicon codicon-list-tree" /> List
                </>
              ) : (
                <>
                  <i className="codicon codicon-edit" /> Write
                </>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="ft-tree">
        {tree.length === 0 ? (
          <p className="ft-empty">
            {filter !== 'all' || Boolean(search.trim())
              ? 'No files match the current filter.'
              : 'No files accessible.'}
          </p>
        ) : (
          tree.map((node) => (
            <FileTreeNodeRow
              key={node.path}
              node={node}
              depth={0}
              editMode={editMode}
              highlightedPaths={highlightedPaths}
              pendingPaths={pendingPaths}
              onToggle={onTogglePermission}
            />
          ))
        )}
      </div>
    </div>
  );
}
