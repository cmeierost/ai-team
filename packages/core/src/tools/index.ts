/**
 * Tool system - defines tools that agents can use
 * Mirrors VS Code Copilot capabilities (Feb 2026)
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import { minimatch } from 'minimatch';
import { z } from 'zod';
import {
  AgentTool,
  ToolContext,
} from '../types/index.js';
import { ContextManager } from '../context/index.js';
import { loadAgent, loadTeamConfig, saveAgent } from '../storage/index.js';
import { AgentManager } from '../agent/index.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
const MAX_SEMANTIC_FILE_SIZE_BYTES = 200_000;

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

// ============================================================================
// Core File Tools
// ============================================================================

/**
 * Read file contents with permission checking
 */
export const readFileTool: AgentTool = {
  name: 'read_file',
  description: 'Read contents of a file. Requires read permission.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    startLine: z.number().optional().describe('1-based line number to start reading from'),
    endLine: z.number().optional().describe('1-based line number to end reading at'),
  }),
  async execute(params, context: ToolContext) {
    const { filePath, startLine, endLine } = params as any;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);

    const contextManager = new ContextManager(context.workspaceRoot);
    contextManager.assertCanRead(context.agent, absolutePath);

    const content = await fs.readFile(absolutePath, 'utf-8');
    
    if (startLine !== undefined && endLine !== undefined) {
      const lines = content.split('\n');
      return lines.slice(startLine - 1, endLine).join('\n');
    }
    
    return content;
  },
};

/**
 * Search for files by glob pattern
 */
export const fileSearchTool: AgentTool = {
  name: 'file_search',
  description: 'Find files matching a glob pattern. Returns only files the agent has permission to read.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern to match files'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  }),
  async execute(params, context: ToolContext) {
    const { pattern, maxResults = 100 } = params as any;
    
    const files = await glob(pattern, {
      cwd: context.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    const contextManager = new ContextManager(context.workspaceRoot);
    const readableFiles = contextManager.getReadableFiles(context.agent, files);

    return readableFiles.slice(0, maxResults);
  },
};

/**
 * Write or modify file contents
 */
export const writeFileTool: AgentTool = {
  name: 'write_file',
  description: 'Write or modify file contents. Requires write permission.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().describe('New file content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
  async execute(params, context: ToolContext) {
    const { filePath, content, createDirectories = false } = params as any;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);

    const contextManager = new ContextManager(context.workspaceRoot);
    contextManager.assertCanWrite(context.agent, absolutePath);

    if (createDirectories) {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    }

    await fs.writeFile(absolutePath, content, 'utf-8');
    return { success: true, path: absolutePath };
  },
};

// ============================================================================
// Search & Analysis Tools
// ============================================================================

/**
 * Semantic search across codebase (placeholder - would integrate with vector DB)
 */
export const semanticSearchTool: AgentTool = {
  name: 'semantic_search',
  description: 'Search codebase semantically for relevant code and documentation.',
  parameters: z.object({
    query: z.string().describe('Natural language search query'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  }),
  async execute(params, context: ToolContext) {
    const { query, maxResults = 10 } = params as { query: string; maxResults?: number };

    const files = await glob('**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml}', {
      cwd: context.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
    });

    const contextManager = new ContextManager(context.workspaceRoot);
    const readableFiles = contextManager.getReadableFiles(context.agent, files);

    const tokens: string[] = query
      .toLowerCase()
      .split(/[^a-z0-9_\-/]+/)
      .map((part: string) => part.trim())
      .filter((part: string) => part.length >= 2);

    const scored: Array<{ filePath: string; score: number; snippet: string }> = [];

    for (const filePath of readableFiles) {
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        continue;
      }

      if (!stat.isFile() || stat.size > MAX_SEMANTIC_FILE_SIZE_BYTES) {
        continue;
      }

      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      const lower = content.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (lower.includes(token)) {
          score += 1;
        }
      }

      if (score === 0) {
        continue;
      }

      const firstToken = tokens.find((token: string) => lower.includes(token));
      const tokenIndex = firstToken ? lower.indexOf(firstToken) : 0;
      const snippetStart = Math.max(0, tokenIndex - 120);
      const snippetEnd = Math.min(content.length, tokenIndex + 220);
      const snippet = content.slice(snippetStart, snippetEnd).trim();

      scored.push({
        filePath,
        score,
        snippet,
      });
    }

    scored.sort((a, b) => b.score - a.score);

    return {
      query,
      results: scored.slice(0, maxResults).map(entry => ({
        filePath: entry.filePath,
        score: entry.score,
        snippet: entry.snippet,
      })),
    };
  },
};

/**
 * Get compiler/linter errors
 */
export const getErrorsTool: AgentTool = {
  name: 'get_errors',
  description: 'Get compile or lint errors for specified files.',
  parameters: z.object({
    filePaths: z.array(z.string()).optional().describe('Files to check (omit for all files)'),
  }),
  async execute(params, context: ToolContext) {
    const { filePaths } = params as { filePaths?: string[] };
    const timeoutMs = 120_000;

    const { stdout = '', stderr = '' } = await withTimeout(
      execFileAsync('pnpm', ['-r', 'build'], {
        cwd: context.workspaceRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
      }),
      timeoutMs,
      `get_errors timed out after ${timeoutMs / 1000}s`,
    );

    const output = `${stdout}\n${stderr}`;
    const lines = output.split(/\r?\n/);

    const normalizedFilters = (filePaths || []).map(filePath => {
      const absolute = path.isAbsolute(filePath)
        ? filePath
        : path.join(context.workspaceRoot, filePath);
      return path.normalize(absolute);
    });

    const errors = lines
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => /error\s+TS\d+|\berror\b/i.test(line))
      .filter(line => {
        if (normalizedFilters.length === 0) {
          return true;
        }

        const normalizedLine = path.normalize(line);
        return normalizedFilters.some(filterPath => normalizedLine.includes(filterPath));
      });

    return {
      errors,
    };
  },
};

// ============================================================================
// Agent Collaboration Tools
// ============================================================================

/**
 * Delegate task to another agent
 */
export const delegateToAgentTool: AgentTool = {
  name: 'delegate_to_agent',
  description: 'Delegate a task to another agent. Checks delegation permissions.',
  parameters: z.object({
    agentId: z.string().describe('Target agent ID'),
    task: z.string().describe('Task description'),
    context: z.array(z.string()).optional().describe('File paths for context'),
  }),
  async execute(params, context: ToolContext) {
    const { agentId, task, context: contextFiles } = params as any;
    
    // Check if agent can delegate to target
    if (!context.agent.delegatesTo?.includes(agentId)) {
      throw new Error(`Agent ${context.agent.id} cannot delegate to ${agentId}`);
    }

    return {
      delegatedTo: agentId,
      task,
      contextFiles,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Ask human for clarification
 */
export const askHumanTool: AgentTool = {
  name: 'ask_human',
  description: 'Ask the human developer a structured question. Supports input, confirm, select, checklist, and password modes.',
  parameters: z.object({
    question: z.string().min(1).describe('Question to ask the developer'),
    questionType: z.enum(['input', 'confirm', 'select', 'checklist', 'password']).optional().describe('Question mode (defaults to input)'),
    context: z.string().optional().describe('Optional additional context shown with the question'),
    choices: z.array(z.object({
      name: z.string().min(1),
      value: z.string().min(1),
    })).optional().describe('Required for select/checklist modes'),
    default: z.union([z.string(), z.boolean(), z.array(z.string())]).optional().describe('Optional default answer'),
    mask: z.string().optional().describe('Optional mask character for password mode'),
    allowEmpty: z.boolean().optional().describe('Allow empty input for input mode'),
  }).superRefine((value, refinementCtx) => {
    const questionType = value.questionType ?? 'input';
    if ((questionType === 'select' || questionType === 'checklist') && (!value.choices || value.choices.length === 0)) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `choices are required when questionType is '${questionType}'`,
      });
    }
  }),
  async execute(params, context: ToolContext) {
    const { question, context: additionalContext, questionType = 'input', choices } = params as any;
    
    return {
      question,
      questionType,
      context: additionalContext,
      choices,
      requestedBy: context.agent.id,
      timestamp: new Date().toISOString(),
    };
  },
};

export const askQuestionTool: AgentTool = {
  ...askHumanTool,
  name: 'ask_question',
};

/**
 * Register a CLI command for an employee so it can be executed via run_cli_tool.
 */
export const registerCliTool: AgentTool = {
  name: 'register_cli_tool',
  description: 'Allow this employee to run a command-line tool by executable name (e.g. git, pnpm, node).',
  parameters: z.object({
    command: z.string().min(1).describe('Executable name to allow (no args, e.g. git)'),
    employee: z.string().optional().describe('Optional target employee name/id/role (defaults to current agent)'),
  }),
  async execute(params, context: ToolContext) {
    const { command, employee } = params as { command: string; employee?: string };
    const normalized = normalizeExecutableName(command);
    if (!normalized) {
      throw new Error('Invalid command name. Provide executable only (for example: git).');
    }

    const teamConfig = await loadTeamConfig(context.workspaceRoot);
    const allowedGlobal = teamConfig?.allowedCliTools;
    if (allowedGlobal && allowedGlobal.length > 0) {
      const normalizedGlobal = new Set(allowedGlobal.map(normalizeExecutableName).filter(Boolean) as string[]);
      if (!normalizedGlobal.has(normalized)) {
        throw new Error(`Command '${normalized}' is not in global allowedCliTools. Ask HR to add it to .ai-team/config.json first.`);
      }
    }

    let targetAgent = context.agent;
    if (employee && employee.trim().length > 0) {
      const agentManager = new AgentManager(context.workspaceRoot);
      await agentManager.initialize();
      const matches = agentManager.resolveAgent(employee.trim());

      if (matches.length === 0) {
        throw new Error(`No employee found matching '${employee}'.`);
      }
      if (matches.length > 1) {
        throw new Error(`Multiple employees match '${employee}'. Please be more specific.`);
      }

      const candidate = matches[0];
      const canManage = context.agent.permissions?.manage_agents === true;
      const isManager = candidate.reportsTo === context.agent.id;
      const isSelf = candidate.id === context.agent.id;

      if (!canManage && !isManager && !isSelf) {
        throw new Error(`Agent ${context.agent.id} cannot grant CLI tools for ${candidate.id}.`);
      }

      targetAgent = candidate;
    }

    const agentRecord = await loadAgent(targetAgent.filePath);
    const current = new Set((agentRecord.cliTools || []).map(entry => normalizeExecutableName(entry)).filter(Boolean) as string[]);
    current.add(normalized);

    agentRecord.cliTools = [...current].sort();
    await saveAgent(agentRecord);

    if (targetAgent.id === context.agent.id) {
      context.agent.cliTools = agentRecord.cliTools;
    }

    return {
      employee: targetAgent.id,
      command: normalized,
      cliTools: agentRecord.cliTools,
      persisted: true,
    };
  },
};

/**
 * Update an employee-specific LLM profile (provider/model/params).
 */
export const updateEmployeeLlmTool: AgentTool = {
  name: 'update_employee_llm',
  description: 'Update another employee\'s LLM profile (model, provider, and generation params).',
  parameters: z.object({
    employee: z.string().min(1).describe('Target employee name/id/role'),
    provider: z.string().optional(),
    modelKey: z.string().optional(),
    model: z.string().optional(),
    baseUrl: z.string().url().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().optional(),
    presencePenalty: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    stop: z.array(z.string()).optional(),
  }),
  async execute(params, context: ToolContext) {
    const {
      employee,
      provider,
      modelKey,
      model,
      baseUrl,
      temperature,
      maxTokens,
      topP,
      presencePenalty,
      frequencyPenalty,
      stop,
    } = params as {
      employee: string;
      provider?: string;
      modelKey?: string;
      model?: string;
      baseUrl?: string;
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      presencePenalty?: number;
      frequencyPenalty?: number;
      stop?: string[];
    };

    const agentManager = new AgentManager(context.workspaceRoot);
    await agentManager.initialize();
    const matches = agentManager.resolveAgent(employee.trim());
    if (matches.length === 0) {
      throw new Error(`No employee found matching '${employee}'.`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple employees match '${employee}'. Please be more specific.`);
    }

    const target = matches[0];
    const canManage = context.agent.permissions?.manage_agents === true;
    const isManager = target.reportsTo === context.agent.id;
    const isSelf = target.id === context.agent.id;
    if (!canManage && !isManager && !isSelf) {
      throw new Error(`Agent ${context.agent.id} cannot update LLM settings for ${target.id}.`);
    }

    const record = await loadAgent(target.filePath);
    const currentProfile = record.llm || {};
    const currentParams = currentProfile.params || {};

    const nextParams = {
      ...currentParams,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(topP !== undefined ? { topP } : {}),
      ...(presencePenalty !== undefined ? { presencePenalty } : {}),
      ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
      ...(stop !== undefined ? { stop } : {}),
    };

    const nextProfile = {
      ...currentProfile,
      ...(provider !== undefined ? { provider } : {}),
      ...(modelKey !== undefined ? { modelKey } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      params: Object.keys(nextParams).length > 0 ? nextParams : undefined,
    };

    record.llm = nextProfile;
    await saveAgent(record);

    return {
      employee: target.id,
      llm: nextProfile,
      persisted: true,
    };
  },
};

/**
 * Run a CLI tool that was previously allowed for this employee.
 */
export const runCliTool: AgentTool = {
  name: 'run_cli_tool',
  description: 'Execute an allowed command-line tool with args. Command must be registered first via register_cli_tool.',
  parameters: z.object({
    command: z.string().min(1).describe('Executable name, for example git'),
    args: z.array(z.string()).optional().describe('Command arguments as array, for example ["status", "--short"]'),
    cwd: z.string().optional().describe('Optional relative working directory (defaults to workspace root)'),
  }),
  async execute(params, context: ToolContext) {
    const { command, args = [], cwd } = params as { command: string; args?: string[]; cwd?: string };
    const normalized = normalizeExecutableName(command);
    if (!normalized) {
      throw new Error('Invalid command name. Provide executable only (for example: git).');
    }

    const allowed = new Set((context.agent.cliTools || []).map(entry => normalizeExecutableName(entry)).filter(Boolean) as string[]);
    if (!allowed.has(normalized)) {
      throw new Error(`Command '${normalized}' is not allowed for ${context.agent.name}. Register it first with register_cli_tool.`);
    }

    const execCwd = cwd
      ? path.resolve(context.workspaceRoot, cwd)
      : context.workspaceRoot;

    enforceCommandAreaScope(context, execCwd);

    const { stdout = '', stderr = '' } = await withTimeout(
      execFileAsync(normalized, args, {
        cwd: execCwd,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
      }),
      60_000,
      `run_cli_tool timed out after 60s (${normalized})`,
    );

    return {
      command: normalized,
      args,
      cwd: execCwd,
      stdout: stdout.trim(),
      stderr: stderr.trim() || undefined,
    };
  },
};

function normalizeExecutableName(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.includes(' ') || trimmed.includes('/') || trimmed.includes('\\')) {
    return undefined;
  }

  return trimmed.toLowerCase();
}

function enforceCommandAreaScope(context: ToolContext, execCwd: string): void {
  if (!path.resolve(execCwd).startsWith(path.resolve(context.workspaceRoot))) {
    throw new Error('run_cli_tool cwd must stay inside the workspace root.');
  }

  const readPatterns = context.agent.permissions?.read;
  if (!readPatterns || readPatterns.length === 0) {
    return;
  }

  const relative = path.relative(context.workspaceRoot, execCwd).replace(/\\/g, '/');
  const relativePath = relative.length === 0 ? '.' : relative;
  const isAllowed = readPatterns.some(pattern =>
    minimatch(relativePath, pattern)
    || minimatch(`${relativePath}/**/*`, pattern)
    || minimatch(relativePath, pattern.replace(/\/\*\*\/*\*$/, '')),
  );

  if (!isAllowed) {
    throw new Error(`Command cwd '${relativePath}' is outside ${context.agent.name}'s responsibility scope.`);
  }
}

// ============================================================================
// HR Tools (restricted to HR Director)
// ============================================================================

/**
 * Create a new agent
 */
export const createAgentTool: AgentTool = {
  name: 'create_agent',
  description: 'Create a new virtual team member. Requires manage_agents permission.',
  parameters: z.object({
    name: z.string(),
    role: z.string(),
    contextLevel: z.string(),
    reportsTo: z.string().optional(),
    features: z.array(z.string()).optional(),
  }),
  async execute(params, context: ToolContext) {
    if (!context.agent.permissions?.manage_agents) {
      throw new Error(`Agent ${context.agent.id} does not have permission to create agents`);
    }

    // Placeholder: Would call AgentManager.createAgent()
    return {
      action: 'create_agent',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Archive an agent
 */
export const archiveAgentTool: AgentTool = {
  name: 'archive_agent',
  description: 'Archive (offboard) a virtual team member. Requires manage_agents permission.',
  parameters: z.object({
    agentId: z.string().describe('Agent ID to archive'),
    reason: z.string().optional().describe('Reason for archiving'),
  }),
  async execute(params, context: ToolContext) {
    if (!context.agent.permissions?.manage_agents) {
      throw new Error(`Agent ${context.agent.id} does not have permission to archive agents`);
    }

    return {
      action: 'archive_agent',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Assess agent performance
 */
export const assessPerformanceTool: AgentTool = {
  name: 'assess_performance',
  description: 'Analyze agent activity and performance metrics. Requires manage_agents permission.',
  parameters: z.object({
    agentId: z.string().optional().describe('Specific agent (omit for all)'),
    period: z.string().optional().describe('Time period (e.g., "last-30-days")'),
  }),
  async execute(params, context: ToolContext) {
    if (!context.agent.permissions?.manage_agents) {
      throw new Error(`Agent ${context.agent.id} does not have permission to assess performance`);
    }

    // Placeholder: Would analyze chat logs and meeting summaries
    return {
      action: 'assess_performance',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

export const CORE_TOOLS: Record<string, AgentTool> = {
  read_file: readFileTool,
  file_search: fileSearchTool,
  write_file: writeFileTool,
  semantic_search: semanticSearchTool,
  get_errors: getErrorsTool,
  register_cli_tool: registerCliTool,
  update_employee_llm: updateEmployeeLlmTool,
  run_cli_tool: runCliTool,
  delegate_to_agent: delegateToAgentTool,
  ask_human: askHumanTool,
  ask_question: askQuestionTool,
};

export const HR_TOOLS: Record<string, AgentTool> = {
  create_agent: createAgentTool,
  archive_agent: archiveAgentTool,
  assess_performance: assessPerformanceTool,
};

export const ALL_TOOLS: Record<string, AgentTool> = {
  ...CORE_TOOLS,
  ...HR_TOOLS,
};

/**
 * Get tools available to an agent
 * @param agent - Agent to get tools for
 * @returns Map of tool name to tool definition
 */
export function getAgentTools(agent: { tools?: string[]; permissions?: { manage_agents?: boolean } }): Record<string, AgentTool> {
  const tools: Record<string, AgentTool> = {};
  
  // Add explicitly granted tools
  if (agent.tools) {
    for (const toolName of agent.tools) {
      if (ALL_TOOLS[toolName]) {
        tools[toolName] = ALL_TOOLS[toolName];
      }
    }
  }
  
  // Add HR tools if agent has permission
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
