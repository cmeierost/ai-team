/**
 * Built-in tool and shell command descriptors for the AccessEngine.
 *
 * These declarations tell the engine how each tool/command touches files,
 * so that checkToolCall() and checkCommand() can evaluate access rights.
 */

import type { AccessEngine } from '@ai-team/access';
import { FS_TOOL_REQUIRED_RIGHT } from '@ai-team/fs';

/**
 * Register ToolDescriptors for every built-in AI Team tool
 * that performs file operations.
 */
export function registerBuiltInToolDescriptors(engine: AccessEngine): void {
  // -- File tools --

  engine.registerTool({
    name: 'read_file',
    pathParams: [{ paramName: 'filePath', right: 'read' }],
    description: 'Read file contents',
  });

  engine.registerTool({
    name: 'write_file',
    pathParams: [{ paramName: 'filePath', right: 'write' }],
    description: 'Write or modify file contents',
  });

  engine.registerTool({
    name: 'file_search',
    pathParams: [],
    description: 'Search for files by glob (results filtered by read access)',
  });

  engine.registerTool({
    name: 'semantic_search',
    pathParams: [],
    description: 'Semantic code search (results filtered by read access)',
  });

  // -- fs_* tools --

  engine.registerTool({
    name: 'fs_read_file',
    pathParams: [{ paramName: 'filePath', right: FS_TOOL_REQUIRED_RIGHT.fs_read_file }],
    description: 'Read file contents with fs contract rights',
  });

  engine.registerTool({
    name: 'fs_read_lines',
    pathParams: [{ paramName: 'filePath', right: FS_TOOL_REQUIRED_RIGHT.fs_read_lines }],
    description: 'Read line ranges with fs contract rights',
  });

  engine.registerTool({
    name: 'fs_write_file',
    pathParams: [{ paramName: 'filePath', right: FS_TOOL_REQUIRED_RIGHT.fs_write_file }],
    description: 'Write file contents with fs contract rights',
  });

  engine.registerTool({
    name: 'fs_create_file',
    pathParams: [{ paramName: 'filePath', right: FS_TOOL_REQUIRED_RIGHT.fs_create_file }],
    description: 'Create file with fs contract rights',
  });

  engine.registerTool({
    name: 'fs_delete_path',
    pathParams: [{ paramName: 'path', right: FS_TOOL_REQUIRED_RIGHT.fs_delete_path }],
    description: 'Delete file/directory with fs contract rights',
  });

  engine.registerTool({
    name: 'fs_mkdir',
    pathParams: [{ paramName: 'path', right: FS_TOOL_REQUIRED_RIGHT.fs_mkdir }],
    description: 'Create directory with fs contract rights',
  });

  engine.registerTool({
    name: 'fs_exists',
    pathParams: [{ paramName: 'path', right: FS_TOOL_REQUIRED_RIGHT.fs_exists }],
    description: 'Check path existence (list-right operation)',
  });

  engine.registerTool({
    name: 'fs_info',
    pathParams: [{ paramName: 'path', right: FS_TOOL_REQUIRED_RIGHT.fs_info }],
    description: 'Get path metadata and access info (list-right operation)',
  });

  engine.registerTool({
    name: 'fs_list',
    pathParams: [{ paramName: 'path', right: FS_TOOL_REQUIRED_RIGHT.fs_list }],
    description: 'List directory contents (list-right operation)',
  });

  engine.registerTool({
    name: 'fs_tree',
    pathParams: [{ paramName: 'path', right: FS_TOOL_REQUIRED_RIGHT.fs_tree }],
    description: 'Build directory tree (list-right operation)',
  });

  engine.registerTool({
    name: 'fs_search_content',
    pathParams: [{ paramName: 'path', right: FS_TOOL_REQUIRED_RIGHT.fs_search_content }],
    description: 'Search file contents (list-right operation)',
  });

  engine.registerTool({
    name: 'fs_search_metadata',
    pathParams: [{ paramName: 'path', right: FS_TOOL_REQUIRED_RIGHT.fs_search_metadata }],
    description: 'Search metadata/path names (list-right operation)',
  });

  engine.registerTool({
    name: 'who_has_access',
    pathParams: [{ paramName: 'path', right: 'list' }],
    description: 'Show which contexts can access a path (default right: list)',
  });

  engine.registerTool({
    name: 'do_i_have_access',
    pathParams: [{ paramName: 'path', right: 'list' }],
    description: 'Check whether a context has access to a path (default right: list)',
  });

  // -- Code intelligence tools --

  engine.registerTool({
    name: 'find_symbol',
    pathParams: [{ paramName: 'filePath', right: 'read' }],
    description: 'Find symbol definitions',
  });

  engine.registerTool({
    name: 'find_references',
    pathParams: [],
    description: 'Find references (results filtered by read access)',
  });

  engine.registerTool({
    name: 'find_pattern',
    pathParams: [],
    description: 'Find code patterns (results filtered by read access)',
  });

  engine.registerTool({
    name: 'grep_code',
    pathParams: [],
    description: 'Grep-style text search (results filtered by read access)',
  });

  engine.registerTool({
    name: 'analyze_complexity',
    pathParams: [{ paramName: 'filePath', right: 'read' }],
    description: 'Analyze code complexity',
  });

  // -- Code edit tools --

  engine.registerTool({
    name: 'apply_code_edit',
    pathParams: [],
    description: 'Propose code edits (write-checks done against changes[].filePath)',
  });

  // -- CLI compound tool --

  engine.registerTool({
    name: 'run_cli_tool',
    pathParams: [],
    shellParam: 'command',
    description: 'Execute a shell command — delegated to command registry',
  });

  // -- Non-file tools (registered so they are not denied by default policy) --

  for (const name of [
    'delegate_to_agent',
    'ask_human',
    'ask_question',
    'register_cli_tool',
    'update_employee_llm',
    'get_errors',
    'create_agent',
    'archive_agent',
    'assess_performance',
    'add_picture',
  ]) {
    engine.registerTool({
      name,
      pathParams: [],
      description: `Non-file tool: ${name}`,
    });
  }
}

/**
 * Register CommandDescriptors for common CLI tools agents may invoke
 * via run_cli_tool.
 */
export function registerCommonCommandDescriptors(engine: AccessEngine): void {
  // cat / type — read a file
  engine.registerCommand({
    names: ['cat', 'type'],
    pathArgs: [{ right: 'read', extractor: { kind: 'rest', startIndex: 0 } }],
    description: 'Print file contents',
  });

  // less / more / head / tail — read a file
  engine.registerCommand({
    names: ['less', 'more', 'head', 'tail'],
    pathArgs: [{ right: 'read', extractor: { kind: 'rest', startIndex: 0 } }],
    description: 'View file contents',
  });

  // cp — read source, write destination
  engine.registerCommand({
    names: ['cp', 'copy'],
    pathArgs: [
      { right: 'read', extractor: { kind: 'positional', index: 0 } },
      { right: 'write', extractor: { kind: 'positional', index: 1 } },
    ],
    description: 'Copy file: read source, write destination',
  });

  // mv / move — read source, write destination, delete source
  engine.registerCommand({
    names: ['mv', 'move'],
    pathArgs: [
      { right: 'read', extractor: { kind: 'positional', index: 0 } },
      { right: 'delete', extractor: { kind: 'positional', index: 0 } },
      { right: 'write', extractor: { kind: 'positional', index: 1 } },
    ],
    description: 'Move file: read+delete source, write destination',
  });

  // rm / del — delete files
  engine.registerCommand({
    names: ['rm', 'del'],
    pathArgs: [{ right: 'delete', extractor: { kind: 'rest', startIndex: 0 } }],
    description: 'Remove files',
  });

  // mkdir — create directory
  engine.registerCommand({
    names: ['mkdir'],
    pathArgs: [{ right: 'create', extractor: { kind: 'rest', startIndex: 0 } }],
    description: 'Create directory',
  });

  // touch — create file
  engine.registerCommand({
    names: ['touch'],
    pathArgs: [{ right: 'create', extractor: { kind: 'rest', startIndex: 0 } }],
    description: 'Create empty file',
  });

  // ls / dir — list directory
  engine.registerCommand({
    names: ['ls', 'dir'],
    pathArgs: [{ right: 'list', extractor: { kind: 'rest', startIndex: 0 } }],
    description: 'List directory contents',
  });

  // grep / rg / ripgrep — read files
  engine.registerCommand({
    names: ['grep', 'rg'],
    pathArgs: [{ right: 'read', extractor: { kind: 'rest', startIndex: 1 } }],
    description: 'Search file contents (pattern is arg 0, files are rest)',
  });

  // git — read workspace (conservative: no specific path extraction)
  engine.registerCommand({
    names: ['git'],
    pathArgs: [],
    description: 'Git operations (no specific file path extraction)',
  });

  // npm / pnpm / yarn — read workspace
  engine.registerCommand({
    names: ['npm', 'pnpm', 'yarn'],
    pathArgs: [],
    description: 'Package manager operations',
  });

  // tsc / node / npx — no specific file extraction
  engine.registerCommand({
    names: ['tsc', 'node', 'npx', 'tsx'],
    pathArgs: [],
    description: 'Runtime/build tools',
  });
}
