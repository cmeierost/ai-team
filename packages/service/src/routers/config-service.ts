import type {
  IConfigService,
  UserConfig,
  TeamConfig,
  GetMcpServersResponse,
  UpdateMcpServerResponse,
} from '@ai-team/api-contracts';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IAgentManager, IConfigurationStorage } from '@ai-team/core';
import { BadRequestError } from '@ai-team/core';

export class ConfigService implements IConfigService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly configurationStorage: IConfigurationStorage
  ) {}

  async getConfig(): Promise<TeamConfig> {
    return this.configurationStorage.get() as TeamConfig;
  }

  async updateConfig(body: Partial<TeamConfig>): Promise<TeamConfig> {
    for (const [key, value] of Object.entries(body)) {
      await this.configurationStorage.set(key as any, value);
    }
    return this.configurationStorage.get() as TeamConfig;
  }

  async getAgentModelKeys(): Promise<{ usedKeys: string[]; keysByAgent: Record<string, string> }> {
    await this.agentManager.refreshAsync();
    const agents = await this.agentManager.getAllAgentsAsync();
    const keysByAgent: Record<string, string> = {};
    const usedKeySet = new Set<string>();
    for (const agent of agents) {
      if (agent.llm?.modelKey) {
        keysByAgent[agent.id] = agent.llm.modelKey;
        usedKeySet.add(agent.llm.modelKey);
      }
    }
    return { usedKeys: [...usedKeySet], keysByAgent };
  }

  async getUserConfig(): Promise<UserConfig> {
    const settings = this.configurationStorage.get() as TeamConfig & {
      developer?: UserConfig['developer'];
    };
    return {
      developer: settings.developer,
      providers: settings.providers,
      defaultModel: settings.defaultModel,
      modelKeys: settings.modelKeys,
      systemModels: settings.systemModels,
    };
  }

  async saveUserConfig(body: Partial<UserConfig>): Promise<UserConfig> {
    for (const [key, value] of Object.entries(body)) {
      await this.configurationStorage.set(key as any, value, 'user');
    }
    return this.getUserConfig();
  }

  async refreshProviderModels(providerRef: string): Promise<unknown> {
    const config = this.configurationStorage.get() as TeamConfig;
    return (config as any)?.providers?.[providerRef]?.models ?? [];
  }

  async getMcpServers(query?: { agent?: string }): Promise<GetMcpServersResponse> {
    const config = this.configurationStorage.get() as TeamConfig;
    const mcpConfigFiles: string[] = (config as any)?.mcpConfigFiles ?? [];
    const servers: GetMcpServersResponse['servers'] = [];
    for (const relPath of mcpConfigFiles) {
      const absPath = path.resolve(this.workspaceRoot, relPath);
      let raw: string;
      try {
        raw = await readFile(absPath, 'utf-8');
      } catch (err: any) {
        if (err.code === 'ENOENT') continue;
        throw err;
      }
      let parsed: any;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      const mcpServerDefs: Record<string, any> = parsed?.servers ?? {};
      for (const [id, def] of Object.entries(mcpServerDefs)) {
        servers.push({
          id,
          type: def.type ?? 'stdio',
          url: def.url,
          command: def.command,
          args: def.args,
          sourceFile: relPath,
        });
      }
    }

    if (query?.agent) {
      await this.agentManager.refreshAsync();
      const agent = await this.agentManager.getAgentAsync(query.agent);
      if (agent) {
        const allowed: string[] = (agent as any).mcpServers ?? [];
        const disallowed: string[] = (agent as any).disallowedMcpServers ?? [];
        for (const s of servers) {
          if (disallowed.includes(s.id)) {
            s.allowedForAgent = false;
          } else {
            s.allowedForAgent = allowed.includes(s.id);
          }
        }
      }
    }

    return { servers };
  }

  async allowMcpServer(body: { agent: string; server: string }): Promise<UpdateMcpServerResponse> {
    if (!body.agent || !body.server) throw new BadRequestError('agent and server are required');
    await this.agentManager.refreshAsync();
    const agent = await this.agentManager.getAgentAsync(body.agent);
    if (!agent) throw new BadRequestError(`Agent not found: ${body.agent}`);

    const currentAllowed: string[] = (agent as any).mcpServers ?? [];
    const currentDisallowed: string[] = (agent as any).disallowedMcpServers ?? [];
    const alreadyAllowed = currentAllowed.includes(body.server);
    const wasDenied = currentDisallowed.includes(body.server);

    const nextAllowed = alreadyAllowed
      ? currentAllowed
      : [...currentAllowed, body.server].sort((a, b) => a.localeCompare(b));
    const nextDisallowed = currentDisallowed.filter((s) => s !== body.server);
    const changed = !alreadyAllowed || wasDenied;

    if (changed) {
      await this.agentManager.updateAgentAsync(agent.id, {
        mcpServers: nextAllowed,
        disallowedMcpServers: nextDisallowed.length > 0 ? nextDisallowed : undefined,
      } as any);
    }

    return {
      agent: { id: agent.id, name: agent.name, role: agent.role },
      server: body.server,
      mcpServers: nextAllowed,
      changed,
    };
  }

  async disallowMcpServer(body: {
    agent: string;
    server: string;
  }): Promise<UpdateMcpServerResponse> {
    if (!body.agent || !body.server) throw new BadRequestError('agent and server are required');
    await this.agentManager.refreshAsync();
    const agent = await this.agentManager.getAgentAsync(body.agent);
    if (!agent) throw new BadRequestError(`Agent not found: ${body.agent}`);

    const currentAllowed: string[] = (agent as any).mcpServers ?? [];
    const currentDisallowed: string[] = (agent as any).disallowedMcpServers ?? [];
    const nextAllowed = currentAllowed.filter((s) => s !== body.server);
    const alreadyDenied = currentDisallowed.includes(body.server);
    const nextDisallowed = alreadyDenied
      ? currentDisallowed
      : [...currentDisallowed, body.server].sort((a, b) => a.localeCompare(b));
    const changed = nextAllowed.length !== currentAllowed.length || !alreadyDenied;

    if (changed) {
      await this.agentManager.updateAgentAsync(agent.id, {
        mcpServers: nextAllowed.length > 0 ? nextAllowed : undefined,
        disallowedMcpServers: nextDisallowed,
      } as any);
    }

    return {
      agent: { id: agent.id, name: agent.name, role: agent.role },
      server: body.server,
      mcpServers: nextAllowed,
      changed,
    };
  }
}
