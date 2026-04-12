import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import type { AgentFilesResponse, FilePatternsResponse } from '../../types';
import { buildTree, filterFiles, getAccessCounts, getVisiblePatternGroups } from './fileTreeUtils';
import type { FileAccessFilter, PatternMode, PatternScope } from './fileTreeTypes';

export interface UseFileTreeResult {
  data: AgentFilesResponse | null;
  patterns: FilePatternsResponse | null;
  loading: boolean;
  error: string | null;
  pendingPaths: Set<string>;
  pendingPatternKey: string | null;
  patternScope: PatternScope;
  patternMode: PatternMode;
  patternInput: string;
  filter: FileAccessFilter;
  search: string;
  tree: ReturnType<typeof buildTree>;
  readCount: number;
  listCount: number;
  writeCount: number;
  visiblePatternGroups: ReturnType<typeof getVisiblePatternGroups>;
  load: () => Promise<void>;
  setPatternScope: (scope: PatternScope) => void;
  setPatternMode: (mode: PatternMode) => void;
  setPatternInput: (value: string) => void;
  setFilter: (value: FileAccessFilter) => void;
  setSearch: (value: string) => void;
  togglePathPermission: (path: string, mode: PatternMode, current: boolean) => Promise<void>;
  addPattern: () => Promise<void>;
  removePattern: (scope: PatternScope, mode: PatternMode, value: string) => Promise<void>;
}

export function useFileTree(agentId: string): UseFileTreeResult {
  const { client } = useTeam();
  const [data, setData] = useState<AgentFilesResponse | null>(null);
  const [patterns, setPatterns] = useState<FilePatternsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPaths, setPendingPaths] = useState<Set<string>>(new Set());
  const [pendingPatternKey, setPendingPatternKey] = useState<string | null>(null);
  const [patternScope, setPatternScope] = useState<PatternScope>('agent');
  const [patternMode, setPatternMode] = useState<PatternMode>('read');
  const [patternInput, setPatternInput] = useState('');
  const [filter, setFilter] = useState<FileAccessFilter>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [filesJson, patternsJson] = await Promise.all([
        client.agents.getFiles(agentId) as Promise<AgentFilesResponse>,
        client.files.getPatterns({ agent: agentId }) as Promise<FilePatternsResponse>,
      ]);
      setData(filesJson);
      setPatterns(patternsJson);
    } catch (loadError: any) {
      setError(loadError?.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [agentId, client]);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePathPermission = useCallback(async (path: string, mode: PatternMode, current: boolean) => {
    setPendingPaths((previous) => new Set([...previous, path]));
    try {
      if (current) {
        await client.files.disallow({ agent: agentId, path, mode });
      } else {
        await client.files.allow({ agent: agentId, path, mode });
      }
      setData((previous) => {
        if (!previous) {
          return previous;
        }
        return {
          ...previous,
          files: previous.files.map((file) => {
            if (file.path !== path) {
              return file;
            }
            return {
              ...file,
              readable: mode === 'read' ? !current : file.readable,
              listable: file.listable,
              writable: mode === 'write' ? !current : file.writable,
            };
          }),
        };
      });
    } catch (toggleError: any) {
      setError(toggleError?.message || 'Failed to update permission');
    } finally {
      setPendingPaths((previous) => {
        const next = new Set(previous);
        next.delete(path);
        return next;
      });
    }
  }, [agentId, client]);

  const addPattern = useCallback(async () => {
    const value = patternInput.trim();
    if (!value) {
      return;
    }

    const key = `add:${patternScope}:${patternMode}:${value}`;
    setPendingPatternKey(key);
    setError(null);
    try {
      if (patternScope === 'agent') {
        await client.files.allow({ agent: agentId, path: value, mode: patternMode });
      } else {
        await client.files.allowAll({ path: value, mode: patternMode });
      }
      setPatternInput('');
      await load();
    } catch (addError: any) {
      setError(addError?.message || 'Failed to add pattern');
    } finally {
      setPendingPatternKey(null);
    }
  }, [agentId, client, load, patternInput, patternMode, patternScope]);

  const removePattern = useCallback(async (scope: PatternScope, mode: PatternMode, value: string) => {
    const key = `remove:${scope}:${mode}:${value}`;
    setPendingPatternKey(key);
    setError(null);
    try {
      if (scope === 'agent') {
        await client.files.disallow({ agent: agentId, path: value, mode });
      } else {
        await client.files.disallowAll({ path: value, mode });
      }
      await load();
    } catch (removeError: any) {
      setError(removeError?.message || 'Failed to remove pattern');
    } finally {
      setPendingPatternKey(null);
    }
  }, [agentId, client, load]);

  const filteredFiles = useMemo(() => filterFiles(data?.files ?? [], filter, search), [data?.files, filter, search]);
  const tree = useMemo(() => buildTree(filteredFiles), [filteredFiles]);
  const { readCount, listCount, writeCount } = useMemo(() => getAccessCounts(data?.files ?? []), [data?.files]);
  const visiblePatternGroups = useMemo(() => getVisiblePatternGroups(data, patterns), [data, patterns]);

  return {
    data,
    patterns,
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
  };
}
