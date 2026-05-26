import { z } from 'zod';
import type {
  ICommand,
  IAgentManager,
  IConfigurationStorage,
  IPermissionStorage,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { FilesPatternsResponse } from '@ai-team/api-contracts';

type Params = z.infer<typeof FilesPatternsCommand.schema>;
const _filesPatternsCommandSchema = z.object({
  agent: z.string().optional().describe('Show patterns for a specific agent'),
  json: z.boolean().optional().describe('Output as JSON'),
});

export const FilesPatternsCommandMetadata = {
  key: 'patterns',
  description: 'List configured file permission patterns (global or per-agent)',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'fs',
  parameters: _filesPatternsCommandSchema,
} satisfies ICommandDescriptor;

export class FilesPatternsCommand implements ICommand<Params, FilesPatternsResponse> {
  static readonly schema = _filesPatternsCommandSchema;
  readonly metadata = FilesPatternsCommandMetadata;

  constructor(
    private readonly configStorage: IConfigurationStorage,
    private readonly agents: IAgentManager,
    private readonly permStorage: IPermissionStorage
  ) {}

  async execute(
    payload: Params,
    ctx: ExecutionContext
  ): Promise<CommandResponse<FilesPatternsResponse>> {
    const config = await this.configStorage.loadTeamConfigAsync(ctx.workspaceRoot);
    const global = {
      read: config?.fileTree?.readPaths ?? [],
      write: config?.fileTree?.writePaths ?? [],
    };

    if (!payload.agent) {
      return { status: 'ok', data: { global } };
    }

    const matches = await this.agents.resolveAgentAsync(payload.agent);
    if (matches.length === 0) {
      throw new Error(`Agent not found: "${payload.agent}"`);
    }
    const agent = matches[0];
    const patterns = await this.permStorage.loadAsync(agent.id);

    return {
      status: 'ok',
      data: {
        global,
        agent: { id: agent.id, name: agent.name, role: agent.role },
        agentPatterns: { read: patterns.read ?? [], write: patterns.write ?? [] },
      },
    };
  }
}
