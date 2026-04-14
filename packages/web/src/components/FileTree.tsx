/**
 * FileTree component — shows workspace files annotated with an agent's read/list/write
 * permissions. In view mode, shows which files are readable/listable/writable. In edit mode,
 * allows toggling read and write access per file.
 */
import { useEffect } from 'react';
import { FileTreeView } from './file-tree/FileTreeView';
import { useFileTree } from './file-tree/useFileTree';
import './FileTree.css';

export interface FileTreeCounts {
  readCount: number;
  listCount: number;
  writeCount: number;
}

interface FileTreeProps {
  agentId: string;
  editMode: boolean;
  highlightedPaths?: ReadonlySet<string>;
  onCountsChange?: (counts: FileTreeCounts) => void;
}

export function FileTree({ agentId, editMode, highlightedPaths, onCountsChange }: Readonly<FileTreeProps>) {
  const {
    data,
    loading,
    error,
    pendingPaths,
    pendingPatternKey,
    patternScope,
    patternMode,
    patternInput,
    filter,
    search,
    tree,
    readCount,
    listCount,
    writeCount,
    visiblePatternGroups,
    load,
    setPatternScope,
    setPatternMode,
    setPatternInput,
    setFilter,
    setSearch,
    togglePathPermission,
    addPattern,
    removePattern,
  } = useFileTree(agentId);

  useEffect(() => {
    onCountsChange?.({ readCount, listCount, writeCount });
  }, [readCount, listCount, writeCount, onCountsChange]);

  return (
    <FileTreeView
      editMode={editMode}
      loading={loading}
      error={error}
      hasData={Boolean(data)}
      readCount={readCount}
      listCount={listCount}
      writeCount={writeCount}
      patternsOpen={visiblePatternGroups.length > 0}
      visiblePatternGroups={visiblePatternGroups}
      pendingPatternKey={pendingPatternKey}
      patternScope={patternScope}
      patternMode={patternMode}
      patternInput={patternInput}
      filter={filter}
      search={search}
      tree={tree}
      highlightedPaths={highlightedPaths}
      pendingPaths={pendingPaths}
      onRetry={() => {
        void load();
      }}
      onPatternScopeChange={setPatternScope}
      onPatternModeChange={setPatternMode}
      onPatternInputChange={setPatternInput}
      onAddPattern={() => {
        void addPattern();
      }}
      onRemovePattern={(scope, mode, value) => {
        void removePattern(scope, mode, value);
      }}
      onSearchChange={setSearch}
      onFilterChange={setFilter}
      onTogglePermission={(path, mode, current) => {
        void togglePathPermission(path, mode, current);
      }}
    />
  );
}
