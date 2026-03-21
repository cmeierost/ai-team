/**
 * Tool system - defines tools that agents can use
 * Mirrors VS Code Copilot capabilities (Feb 2026)
 *
 * This barrel re-exports tool definitions from focused sub-modules and
 * assembles the canonical tool registries (CORE_TOOLS, HR_TOOLS, ALL_TOOLS).
 */

import { type AgentTool, type ToolContext } from '../types/index.js';
import { DEFAULT_TOOL_TIMEOUT_MS, withTimeout } from './tool-utils.js';

// ---------------------------------------------------------------------------
// Sub-module re-exports (every exported tool is available to consumers)
// ---------------------------------------------------------------------------

export { whoHasAccessTool, doIHaveAccessTool } from './access-introspection-tools.js';

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
} from './fs-tools.js';

export { semanticSearchTool, getErrorsTool } from './search-tools.js';

export {
  delegateToAgentTool,
  registerCliTool,
  updateEmployeeLlmTool,
  runCliTool,
} from './agent-tools.js';

export {
  createAgentTool,
  archiveAgentTool,
  assessPerformanceTool,
  addPictureTool,
} from './hr-tools.js';

export {
  findSymbolTool,
  findReferencesTool,
  lspTool,
  grepCodeTool,
  analyzeComplexityTool,
  applyCodeEditTool,
} from './code-tools.js';

export { httpFetchTool, httpCrawlTool } from './http-tools.js';

export { applyPatchTool, multiEditTool, fsEditTool } from './edit-tools.js';

export { DEFAULT_TOOL_TIMEOUT_MS, withTimeout } from './tool-utils.js';

// ---------------------------------------------------------------------------
// Internal imports (used only by the registries below)
// ---------------------------------------------------------------------------

import { whoHasAccessTool, doIHaveAccessTool } from './access-introspection-tools.js';
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
} from './fs-tools.js';
import { semanticSearchTool, getErrorsTool } from './search-tools.js';
import {
  delegateToAgentTool,
  registerCliTool,
  updateEmployeeLlmTool,
  runCliTool,
} from './agent-tools.js';
import {
  archiveAgentTool,
  assessPerformanceTool,
  addPictureTool,
} from './hr-tools.js';
import {
  findSymbolTool,
  findReferencesTool,
  lspTool,
  grepCodeTool,
  analyzeComplexityTool,
  applyCodeEditTool,
} from './code-tools.js';
import { httpFetchTool, httpCrawlTool } from './http-tools.js';
import { applyPatchTool, multiEditTool, fsEditTool } from './edit-tools.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface ToolExecutionRequest {
  toolName: string;
  params: unknown;
  context: ToolContext;
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

export const CORE_TOOLS: Record<string, AgentTool> = {
  fs_read: fsReadFileTool,
  fs_read_lines: fsReadLinesTool,
  fs_write_file: fsWriteFileTool,
  fs_create: fsCreateFileTool,
  fs_delete_path: fsDeletePathTool,
  fs_mkdir: fsMkdirTool,
  fs_exists: fsExistsTool,
  fs_info: fsInfoTool,
  fs_list: fsListTool,
  fs_tree: fsTreeTool,
  fs_search_content: fsSearchContentTool,
  fs_search_metadata: fsSearchMetadataTool,
  fs_who_can: whoHasAccessTool,
  tool_can_i: doIHaveAccessTool,
  search_semantic: semanticSearchTool,
  tool_get_errors: getErrorsTool,
  tool_register_cli: registerCliTool,
  hr_update_llm: updateEmployeeLlmTool,
  tool_run: runCliTool,
  com_delegate: delegateToAgentTool,
  find_symbol: findSymbolTool,
  find_references: findReferencesTool,
  lsp: lspTool,
  search_grep: grepCodeTool,
  http_fetch: httpFetchTool,
  http_crawl: httpCrawlTool,
  analyze_complexity: analyzeComplexityTool,
  analyze_performance: assessPerformanceTool,
  fs_apply_patch: applyCodeEditTool,
  fs_edit: fsEditTool,
  apply_patch: applyPatchTool,
  multiedit: multiEditTool,
};

export const HR_TOOLS: Record<string, AgentTool> = {
  hr_archive: archiveAgentTool,
  hr_avatar: addPictureTool,
};

export const ALL_TOOLS: Record<string, AgentTool> = {
  ...CORE_TOOLS,
  ...HR_TOOLS,
};

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

export function getAgentTools(agent: { tools?: string[]; permissions?: { manage_agents?: boolean } }): Record<string, AgentTool> {
  const tools: Record<string, AgentTool> = {};

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
  options?: ToolExecutionOptions,
): Promise<ToolExecutionResult> {
  const { toolName, params, context } = request;
  const availableTools = getAgentTools(context.agent);
  const tool = availableTools[toolName];

  if (!tool) {
    return {
      ok: false,
      toolName,
      error: `Tool not allowed for agent: ${toolName}`,
    };
  }

  const approved = options?.onBeforeExecute
    ? await options.onBeforeExecute(request)
    : true;

  if (!approved) {
    return {
      ok: false,
      toolName,
      error: `Tool call denied by user: ${toolName}`,
    };
  }

  const parsed = tool.parameters.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false,
      toolName,
      error: `Invalid parameters for ${toolName}: ${parsed.error.message}`,
    };
  }

  try {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const result = await withTimeout(tool.execute(parsed.data, context), timeoutMs, `Tool ${toolName} timed out`);
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

// ---------------------------------------------------------------------------
// ToolManager — plugin-capable facade (replaces the global CORE_TOOLS map)
// ---------------------------------------------------------------------------

export { ToolManager } from './tool-manager.js';
export type {
  ToolExecutionResult as ToolManagerExecutionResult,
  ToolExecutionOptions as ToolManagerExecutionOptions,
} from './tool-manager.js';
