import { z } from 'zod';
import type { AgentManagementToolDependencies } from '../agents/agent-tools.js';
import { CommandResponse, ExecutionContext, type ICommand } from '@ai-team/core';

function normalizeExecutableName(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(' ') || trimmed.includes('/') || trimmed.includes('\\')) return undefined;
  return trimmed.toLowerCase();
}

export interface RegisterCliParams {
  command: string;
  employee?: string;
}

export interface RegisterCliResult {
  employee: string;
  command: string;
  cliTools: string[];
  persisted: boolean;
}

export class RegisterCliTool implements ICommand<RegisterCliParams, RegisterCliResult> {
  constructor(
    private readonly configurationStorage: AgentManagementToolDependencies['configurationStorage'],
    private readonly agentManager: AgentManagementToolDependencies['agentManager'],
    private readonly agentDocumentStorage: AgentManagementToolDependencies['agentDocumentStorage']
  ) {}

  readonly name = 'register_cli';
  readonly key = 'register_cli';
  readonly group = 'tool';
  readonly availableIn = { tool: true };
  readonly description =
    'Allow this employee to run a command-line tool by executable name (e.g. git, pnpm, node).';
  readonly parameters = z.object({
    command: z.string().min(1).describe('Executable name to allow (no args, e.g. git)'),
    employee: z
      .string()
      .optional()
      .describe('Optional target employee name/id/role (defaults to current agent)'),
  });

  async execute(
    params: RegisterCliParams,
    context: ExecutionContext
  ): Promise<CommandResponse<RegisterCliResult>> {
    const { command, employee } = params;
    const normalized = normalizeExecutableName(command);
    if (!normalized) {
      throw new Error('Invalid command name. Provide executable only (for example: git)');
    }

    const teamConfig = await this.configurationStorage.loadTeamConfigAsync(context.workspaceRoot);
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
      const matches = await this.agentManager.resolveAgentAsync(employee.trim());
      if (matches.length === 0) throw new Error(`No employee found matching '${employee}'.`);
      if (matches.length > 1)
        throw new Error(`Multiple employees match '${employee}'. Please be more specific.`);

      const candidate = matches[0]!;
      const canManage = context.agent.contextLevel === 'organization';
      const isManager = candidate.reportsTo === context.agent.id;
      const isSelf = candidate.id === context.agent.id;
      if (!canManage && !isManager && !isSelf) {
        throw new Error(`Agent ${context.agent.id} cannot grant CLI tools for ${candidate.id}.`);
      }
      targetAgent = candidate;
    }

    const agentRecord = await this.agentDocumentStorage.loadAgentAsync(targetAgent.filePath);
    const current = new Set(
      (agentRecord.cliTools || [])
        .map((entry: string) => normalizeExecutableName(entry))
        .filter(Boolean) as string[]
    );
    current.add(normalized);
    agentRecord.cliTools = [...current].sort((a, b) => a.localeCompare(b));
    await this.agentDocumentStorage.saveAgentAsync(agentRecord);

    if (targetAgent.id === context.agent.id) {
      context.agent.cliTools = agentRecord.cliTools;
    }

    return {
      status: 'ok',
      message: `CLI tool '${normalized}' registered for employee '${targetAgent.id}'.`,
      data: {
        employee: targetAgent.id,
        command: normalized,
        cliTools: agentRecord.cliTools,
        persisted: true,
      },
    };
  }
}
