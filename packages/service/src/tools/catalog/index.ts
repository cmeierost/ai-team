/**
 * Tool catalog — defines tools that agents can use
 * Mirrors VS Code Copilot capabilities (Feb 2026)
 *
 * This barrel re-exports tool definitions from focused sub-modules and
 * assembles the canonical tool registries (CORE_TOOLS, HR_TOOLS, ALL_TOOLS).
 */

import { type ICommand, type ExecutionContext } from '@ai-team/core';
import { DEFAULT_TOOL_TIMEOUT_MS, withTimeout } from '../../utils/with-timeout.js';

// ---------------------------------------------------------------------------
// Sub-module re-exports (every exported tool is available to consumers)
// ---------------------------------------------------------------------------

export {
  whoHasAccessTool,
  doIHaveAccessTool,
  analyzePermissionOverlapTool,
} from '../../commands/fs/access-introspection-tools.js';

export {
  fsExistsTool,
  fsInfoTool,
  fsReadFileTool,
  fsReadLinesTool,
  fsWriteFileTool,
  fsCreateFileTool,
  fsDeletePathTool,
  fsMkdirTool,
  fsListTool,
  fsTreeTool,
  fsSearchContentTool,
  fsSearchMetadataTool,
  FS_TREE_PRE_LLM_PATTERNS,
  matchesFsTreePreLlmIntent,
} from '../../commands/fs/fs-tools.js';

export { type FsPathAccessEnvelope, toFsPathAccessEnvelope } from '../../commands/fs/fs-access.js';


export {
  findSymbolTool,
  findReferencesTool,
  lspTool,
  grepCodeTool,
} from '../../commands/edit/code-tools.js';

export { httpFetchTool, httpCrawlTool } from '../../commands/http/http-tools.js';

export { codeSearchTool } from '../../commands/edit/codesearch-tool.js';

export { applyPatchTool, multiEditTool, fsEditTool } from '../../commands/fs/edit-tools.js';

export { DEFAULT_TOOL_TIMEOUT_MS, withTimeout } from '../../utils/with-timeout.js';

// ---------------------------------------------------------------------------
// Internal imports (used only by the registries below)
// ---------------------------------------------------------------------------

import {
  whoHasAccessTool,
  doIHaveAccessTool,
  analyzePermissionOverlapTool,
} from '../../commands/fs/access-introspection-tools.js';
import {
  fsExistsTool,
  fsInfoTool,
  fsReadFileTool,
  fsReadLinesTool,
  fsWriteFileTool,
  fsCreateFileTool,
  fsDeletePathTool,
  fsMkdirTool,
  fsListTool,
  fsTreeTool,
  fsSearchContentTool,
  fsSearchMetadataTool,
} from '../../commands/fs/fs-tools.js';
import {
  findSymbolTool,
  findReferencesTool,
  lspTool,
  grepCodeTool,
} from '../../commands/edit/code-tools.js';
import { httpFetchTool, httpCrawlTool } from '../../commands/http/http-tools.js';
import { codeSearchTool } from '../../commands/edit/codesearch-tool.js';
import { applyPatchTool, multiEditTool, fsEditTool } from '../../commands/fs/edit-tools.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ToolExecutionRequest {
  toolName: string;
  params: unknown;
  context: ExecutionContext;
}

export interface ToolExecutionResult {
  ok: boolean;
  toolName: string;
  result?: unknown;
  error?: string;
}

export interface ToolExecutionOptions {
  timeoutMs?: number;
  onBeforeExecute?: (request: ToolExecutionRequest) => Promise<boolean> | boolean;
}

// ---------------------------------------------------------------------------
// Tool Registries
// ---------------------------------------------------------------------------

export const CORE_TOOLS: Record<string, any> = {
  read: fsReadFileTool,
  read_lines: fsReadLinesTool,
  write_file: fsWriteFileTool,
  create: fsCreateFileTool,
  delete_path: fsDeletePathTool,
  mkdir: fsMkdirTool,
  exists: fsExistsTool,
  info: fsInfoTool,
  list: fsListTool,
  tree: fsTreeTool,
  search_content: fsSearchContentTool,
  search_metadata: fsSearchMetadataTool,
  who_can: whoHasAccessTool,
  can_i: doIHaveAccessTool,
  analyze_permission_overlap: analyzePermissionOverlapTool,
  find_symbol: findSymbolTool,
  find_references: findReferencesTool,
  lsp: lspTool,
  grep: grepCodeTool,
  fetch: httpFetchTool,
  crawl: httpCrawlTool,
  codesearch: codeSearchTool,
  edit: fsEditTool,
  patch: applyPatchTool,
  multiedit: multiEditTool,
};

export const HR_TOOLS: Record<string, any> = {
};

export const ALL_TOOLS: Record<string, any> = {
  ...CORE_TOOLS,
  ...HR_TOOLS,
};

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

export function getAgentTools(agent: {
  tools?: string[];
  permissions?: { manage_agents?: boolean };
}): Record<string, ICommand> {
  const tools: Record<string, ICommand> = {};

  if (agent.tools) {
    for (const toolName of agent.tools) {
      if (ALL_TOOLS[toolName]) {
        tools[toolName] = ALL_TOOLS[toolName];
      }
    }
  }

  if (agent.permissions?.manage_agents) {
    Object.assign(tools, HR_TOOLS);
  }

  return tools;
}

export async function executeAgentTool(
  request: ToolExecutionRequest,
  options?: ToolExecutionOptions
): Promise<ToolExecutionResult> {
  const { toolName, params, context } = request;
  const availableTools = getAgentTools(context.agent!);
  const tool = availableTools[toolName];

  if (!tool) {
    return {
      ok: false,
      toolName,
      error: `Tool not allowed for agent: ${toolName}`,
    };
  }

  const approved = options?.onBeforeExecute ? await options.onBeforeExecute(request) : true;

  if (!approved) {
    return {
      ok: false,
      toolName,
      error: `Tool call denied by user: ${toolName}`,
    };
  }

  const parsed = tool.parameters?.safeParse(params);
  if (!parsed?.success) {
    return {
      ok: false,
      toolName,
      error: parsed ? `Invalid parameters for ${toolName}: ${parsed.error.message}` : 'No parameters schema',
    };
  }

  try {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const result = await withTimeout(
      tool.execute(parsed.data, context),
      timeoutMs,
      `Tool ${toolName} timed out`
    );
    return {
      ok: true,
      toolName,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      toolName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
