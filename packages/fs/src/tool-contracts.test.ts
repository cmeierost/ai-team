import { describe, expect, it } from 'vitest';
import {
  FS_LIST_RIGHT_TOOLS,
  FS_TOOL_NAMES,
  FS_TOOL_REQUIRED_RIGHT,
} from './tool-contracts.js';

describe('fs tool contracts', () => {
  it('maps exists/info/list/tree/search tools to list rights', () => {
    expect(FS_TOOL_REQUIRED_RIGHT.fs_exists).toBe('list');
    expect(FS_TOOL_REQUIRED_RIGHT.fs_info).toBe('list');
    expect(FS_TOOL_REQUIRED_RIGHT.fs_list).toBe('list');
    expect(FS_TOOL_REQUIRED_RIGHT.fs_tree).toBe('list');
    expect(FS_TOOL_REQUIRED_RIGHT.fs_search_content).toBe('list');
    expect(FS_TOOL_REQUIRED_RIGHT.fs_search_metadata).toBe('list');
  });

  it('has a right mapping for every declared fs tool', () => {
    for (const toolName of FS_TOOL_NAMES) {
      expect(FS_TOOL_REQUIRED_RIGHT[toolName]).toBeDefined();
    }
  });

  it('exposes all list-right tools through FS_LIST_RIGHT_TOOLS', () => {
    const expected = Object.entries(FS_TOOL_REQUIRED_RIGHT)
      .filter(([, right]) => right === 'list')
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b));

    expect([...FS_LIST_RIGHT_TOOLS].sort((a, b) => a.localeCompare(b))).toEqual(expected);
  });
});
