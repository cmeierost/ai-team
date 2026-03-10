/**
 * FileTree component — shows workspace files annotated with an agent's read/write
 * permissions. In view mode, shows which files are readable/writable. In edit mode,
 * allows toggling read and write access per file.
 */
import { FileTreeView } from './file-tree/FileTreeView';
import { useFileTree } from './file-tree/useFileTree';
import './FileTree.css';

interface FileTreeProps {
  agentId: string;
  editMode: boolean;
}

export function FileTree({ agentId, editMode }: Readonly<FileTreeProps>) {
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

  return (
    <FileTreeView
      editMode={editMode}
      loading={loading}
      error={error}
      hasData={Boolean(data)}
      readCount={readCount}
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
