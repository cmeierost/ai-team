import { z } from 'zod';
import {
  CommandResponse,
  ExecutionContext,
  type ICommand,
  type IAgentManager,
  type IAgentDocumentStorage,
  ICommandDescriptor,
} from '@ai-team/core';

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
export const RegisterCliToolMetadata = {
  key: 'register_cli',
  group: 'tool',
  availableIn: { tool: true },
  description:
    'Allow this employee to run a command-line tool by executable name (e.g. git, pnpm, node).',
  parameters: z.object({
    command: z.string().min(1).describe('Executable name to allow (no args, e.g. git)'),
    employee: z
      .string()
      .optional()
      .describe('Optional target employee name/id/role (defaults to current agent)'),
  }),
} satisfies ICommandDescriptor;

export class RegisterCliTool implements ICommand<RegisterCliParams, RegisterCliResult> {
  readonly metadata = RegisterCliToolMetadata;

  constructor(
    private readonly configurationStorage: {
      loadTeamConfigAsync(workspaceRoot: string): Promise<any>;
    },
    private readonly agentManager: IAgentManager,
    private readonly agentDocumentStorage: IAgentDocumentStorage
  ) {}

  readonly name = 'register_cli';

  private async resolveTargetAgent(
    employee: string | undefined,
    currentAgent: NonNullable<ExecutionContext['agent']>
  ) {
    if (!employee || employee.trim().length === 0) {
      return currentAgent;
    }

    const matches = await this.agentManager.resolveAgentAsync(employee.trim());
    if (matches.length === 0) {
      throw new Error(`No employee found matching '${employee}'.`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple employees match '${employee}'. Please be more specific.`);
    }

    const candidate = matches[0];
    const canManage = currentAgent.contextLevel === 'organization';
    const isManager = candidate.reportsTo === currentAgent.id;
    const isSelf = candidate.id === currentAgent.id;
    if (!canManage && !isManager && !isSelf) {
      throw new Error(`Agent ${currentAgent.id} cannot grant CLI tools for ${candidate.id}.`);
    }

    return candidate;
  }

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

    const currentAgent = context.agent;
    if (!currentAgent) {
      throw new Error('register_cli requires an agent context.');
    }

    const targetAgent = await this.resolveTargetAgent(employee, currentAgent);

    const agentRecord = await this.agentDocumentStorage.loadAgentAsync(targetAgent.filePath);
    const current = new Set(
      (agentRecord.cliTools || [])
        .map((entry: string) => normalizeExecutableName(entry))
        .filter(Boolean) as string[]
    );
    current.add(normalized);
    agentRecord.cliTools = [...current].sort((a, b) => a.localeCompare(b));
    await this.agentDocumentStorage.saveAgentAsync(agentRecord);

    if (targetAgent.id === currentAgent.id) {
      currentAgent.cliTools = agentRecord.cliTools;
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
