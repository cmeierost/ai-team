import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { AgentTool } from '@ai-team/core';
import { loadAgent, loadTeamConfig, saveAgent, AgentManager } from '@ai-team/infrastructure';
import { withTimeout } from './tool-utils.js';

const execFileAsync = promisify(execFile);

/**
 * Delegate task to another agent
 */
export const delegateToAgentTool: AgentTool = {
  name: 'delegate',
  group: 'com',
  description: 'Delegate a task to another agent. Checks delegation permissions.',
  parameters: z.object({
    agentId: z.string().describe('Target agent ID'),
    task: z.string().describe('Task description'),
    context: z.array(z.string()).optional().describe('File paths for context'),
  }),
  async execute(params, context) {
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
 * Register a CLI command for an employee so it can be executed via run_cli_tool.
 */
export const registerCliTool: AgentTool = {
  name: 'register_cli',
  group: 'tool',
  description:
    'Allow this employee to run a command-line tool by executable name (e.g. git, pnpm, node).',
  parameters: z.object({
    command: z.string().min(1).describe('Executable name to allow (no args, e.g. git)'),
    employee: z
      .string()
      .optional()
      .describe('Optional target employee name/id/role (defaults to current agent)'),
  }),
  async execute(params, context) {
    const { command, employee } = params as { command: string; employee?: string };
    const normalized = normalizeExecutableName(command);
    if (!normalized) {
      throw new Error('Invalid command name. Provide executable only (for example: git).');
    }

    const teamConfig = await loadTeamConfig(context.workspaceRoot);
    const allowedGlobal = teamConfig?.allowedCliTools;
    if (allowedGlobal && allowedGlobal.length > 0) {
      const normalizedGlobal = new Set(
        allowedGlobal.map(normalizeExecutableName).filter(Boolean) as string[]
      );
      if (!normalizedGlobal.has(normalized)) {
        throw new Error(
          `Command '${normalized}' is not in global allowedCliTools. Ask HR to add it to .ai-team/config.json first.`
        );
      }
    }

    let targetAgent = context.agent;
    if (employee && employee.trim().length > 0) {
      const agentManager = new AgentManager(context.workspaceRoot);
      const matches = await agentManager.resolveAgentAsync(employee.trim());

      if (matches.length === 0) {
        throw new Error(`No employee found matching '${employee}'.`);
      }
      if (matches.length > 1) {
        throw new Error(`Multiple employees match '${employee}'. Please be more specific.`);
      }

      const candidate = matches[0];
      const canManage = context.agent.contextLevel === 'organization';
      const isManager = candidate.reportsTo === context.agent.id;
      const isSelf = candidate.id === context.agent.id;

      if (!canManage && !isManager && !isSelf) {
        throw new Error(`Agent ${context.agent.id} cannot grant CLI tools for ${candidate.id}.`);
      }

      targetAgent = candidate;
    }

    const agentRecord = await loadAgent(targetAgent.filePath);
    const current = new Set(
      (agentRecord.cliTools || [])
        .map((entry) => normalizeExecutableName(entry))
        .filter(Boolean) as string[]
    );
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
  name: 'update_llm',
  group: 'hr',
  description: "Update another employee's LLM profile (model, provider, and generation params).",
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
  async execute(params, context) {
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
    const matches = await agentManager.resolveAgentAsync(employee.trim());
    if (matches.length === 0) {
      throw new Error(`No employee found matching '${employee}'.`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple employees match '${employee}'. Please be more specific.`);
    }

    const target = matches[0];
    const canManage = context.agent.contextLevel === 'organization';
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
  name: 'run',
  group: 'tool',
  description:
    'Execute an allowed command-line tool with args. Command must be registered first via register_cli.',
  formatForLlm(result: unknown): unknown {
    const r = result as { command: string; args: string[]; stdout: string; stderr?: string };
    const cmd = `$ ${r.command}${r.args?.length ? ' ' + r.args.join(' ') : ''}`;
    const out = r.stdout?.trim() || '(no output)';
    const err = r.stderr?.trim();
    return err ? `${cmd}\n\n${out}\n\nstderr:\n${err}` : `${cmd}\n\n${out}`;
  },
  parameters: z.object({
    command: z.string().min(1).describe('Executable name, for example git'),
    args: z
      .array(z.string())
      .optional()
      .describe('Command arguments as array, for example ["status", "--short"]'),
    cwd: z
      .string()
      .optional()
      .describe('Optional relative working directory (defaults to workspace root)'),
  }),
  async execute(params, context) {
    const {
      command,
      args = [],
      cwd,
    } = params as { command: string; args?: string[]; cwd?: string };
    const normalized = normalizeExecutableName(command);
    if (!normalized) {
      throw new Error('Invalid command name. Provide executable only (for example: git).');
    }

    const allowed = new Set(
      (context.agent.cliTools || [])
        .map((entry) => normalizeExecutableName(entry))
        .filter(Boolean) as string[]
    );
    if (!allowed.has(normalized)) {
      throw new Error(
        `Command '${normalized}' is not allowed for ${context.agent.name}. Register it first with register_cli.`
      );
    }

    const execCwd = cwd ? path.resolve(context.workspaceRoot, cwd) : context.workspaceRoot;

    enforceCommandAreaScope(context, execCwd);

    const { stdout = '', stderr = '' } = await withTimeout(
      execFileAsync(normalized, args, {
        cwd: execCwd,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
      }).then((r) => r),
      60_000,
      `tool_run timed out after 60s (${normalized})`
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

function enforceCommandAreaScope(context: { workspaceRoot: string }, execCwd: string): void {
  if (!path.resolve(execCwd).startsWith(path.resolve(context.workspaceRoot))) {
    throw new Error('tool_run cwd must stay inside the workspace root.');
  }
}
