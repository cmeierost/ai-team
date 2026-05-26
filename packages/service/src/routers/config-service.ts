import type {
  IConfigService,
  UserConfig,
  TeamConfig,
  GetMcpServersResponse,
  UpdateMcpServerResponse,
} from '@ai-team/api-contracts';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  IAgentManager,
  IConfigurationStorage,
  IEnvironmentStorage,
  ILlmProviderTester,
} from '@ai-team/core';
import { TeamConfigSchema } from '@ai-team/core';
import { BadRequestError } from '@ai-team/core';

export class ConfigService implements IConfigService {
  constructor(
    private readonly workspaceRoot: string,
    private readonly agentManager: IAgentManager,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly llmProviderTester: ILlmProviderTester
  ) {}

  async getConfig(): Promise<TeamConfig> {
    return (
      (await this.configurationStorage.loadTeamConfigAsync(this.workspaceRoot)) ??
      TeamConfigSchema.parse({ version: '1' })
    );
  }

  async updateConfig(body: Partial<TeamConfig>): Promise<TeamConfig> {
    const existing =
      (await this.configurationStorage.loadTeamConfigAsync(this.workspaceRoot)) ??
      TeamConfigSchema.parse({ version: '1' });
    const merged = { ...existing, ...body } as TeamConfig;
    await this.configurationStorage.saveTeamConfigAsync(this.workspaceRoot, merged as any);
    return merged;
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
    return (await this.configurationStorage.loadUserConfigAsync(this.workspaceRoot)) ?? {};
  }

  async saveUserConfig(body: Partial<UserConfig>): Promise<UserConfig> {
    return this.configurationStorage.saveUserConfigAsync(this.workspaceRoot, body as any);
  }

  async testProviderConnection(
    providerRef: string
  ): Promise<{ ok: boolean; latencyMs?: number; error?: string; message?: string }> {
    const userConfig = await this.configurationStorage.loadUserConfigAsync(this.workspaceRoot);
    const teamConfig = await this.configurationStorage.loadTeamConfigAsync(this.workspaceRoot);
    const provider =
      (userConfig as any)?.providers?.[providerRef] ??
      (teamConfig as any)?.providers?.[providerRef];

    if (!provider) {
      return {
        ok: false,
        error: `Unknown provider '${providerRef}'.`,
      };
    }

    const model = provider.defaultModel ?? provider.models?.[0]?.name;
    if (!model) {
      return {
        ok: false,
        error: `Provider '${providerRef}' has no model configured. Set defaultModel or add models[].`,
      };
    }

    if (provider.kind === 'openai-compatible' && !provider.baseUrl) {
      return {
        ok: false,
        error: `Provider '${providerRef}' is openai-compatible but has no baseUrl.`,
      };
    }

    const llmConfig = {
      provider: provider.kind,
      model,
      baseUrl: provider.baseUrl,
      params: provider.params,
    } as const;

    const envVars = await this.environmentStorage.loadEnvFileAsync(this.workspaceRoot);
    const apiKey = resolveProviderApiKey(provider, envVars);

    const startedAt = Date.now();
    try {
      const message = await this.llmProviderTester.testLlmConnectionAsync(llmConfig, apiKey);
      return {
        ok: true,
        latencyMs: Date.now() - startedAt,
        message,
      };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async refreshUserProviderModels(providerRef: string): Promise<unknown> {
    const config = await this.configurationStorage.loadUserConfigAsync(this.workspaceRoot);
    return (config as any)?.providers?.[providerRef]?.models ?? [];
  }

  async refreshProviderModels(providerRef: string): Promise<unknown> {
    const config = await this.configurationStorage.loadTeamConfigAsync(this.workspaceRoot);
    return (config as any)?.providers?.[providerRef]?.models ?? [];
  }

  async getEnvStatus(): Promise<Record<string, boolean>> {
    const envVars = await this.environmentStorage.loadEnvFileAsync(this.workspaceRoot);
    const teamConfig = await this.configurationStorage.loadTeamConfigAsync(this.workspaceRoot);
    const userConfig = await this.configurationStorage.loadUserConfigAsync(this.workspaceRoot);
    const allProviders: Record<string, any> = {};
    if ((teamConfig as any)?.providers) Object.assign(allProviders, (teamConfig as any).providers);
    if ((userConfig as any)?.providers) Object.assign(allProviders, (userConfig as any).providers);
    const status: Record<string, boolean> = {};
    for (const provider of Object.values(allProviders)) {
      if ((provider as any).kind === 'github-copilot') continue;
      if ((provider as any).kind === 'openai-compatible') {
        const apiKeyEnvVar = (provider as any).apiKeyEnvVar;
        const candidates: string[] = apiKeyEnvVar
          ? [apiKeyEnvVar, 'AI_TEAM_LLM_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY']
          : ['AI_TEAM_LLM_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'];
        const primary = candidates[0];
        status[primary] = candidates.some((k) => Boolean((envVars as any)[k] || process.env[k]));
        continue;
      }
      const apiKeyEnvVar = (provider as any).apiKeyEnvVar;
      if (apiKeyEnvVar) {
        status[apiKeyEnvVar] = !!((envVars as any)[apiKeyEnvVar] || process.env[apiKeyEnvVar]);
      }
    }
    return status;
  }

  async setEnvVar(body: { key: string; value: string }): Promise<{ ok: boolean }> {
    if (!body.key) throw new BadRequestError('key is required');
    const existing = await this.environmentStorage.loadEnvFileAsync(this.workspaceRoot);
    existing[body.key] = body.value;
    await this.environmentStorage.saveEnvFileAsync(this.workspaceRoot, existing);
    return { ok: true };
  }

  async getMcpServers(query?: { agent?: string }): Promise<GetMcpServersResponse> {
    const config = await this.configurationStorage.loadTeamConfigAsync(this.workspaceRoot);
    const mcpConfigFiles: string[] = (config as any)?.mcpConfigFiles ?? [];
    const servers: GetMcpServersResponse['servers'] = [];
    for (const relPath of mcpConfigFiles) {
      const absPath = path.resolve(this.workspaceRoot, relPath);
      let raw: string;
      try {
        raw = await readFile(absPath, 'utf8');
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
          type: (def as any).type ?? 'stdio',
          url: (def as any).url,
          command: (def as any).command,
          args: (def as any).args,
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

function resolveProviderApiKey(provider: any, envVars: Record<string, string>): string | undefined {
  if (provider?.kind !== 'openai-compatible') {
    return undefined;
  }

  const apiKeyEnvVar = provider?.apiKeyEnvVar;
  const candidates: string[] = apiKeyEnvVar
    ? [apiKeyEnvVar, 'AI_TEAM_LLM_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY']
    : ['AI_TEAM_LLM_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'];

  for (const key of candidates) {
    const value = envVars[key] || process.env[key];
    if (value) {
      return value;
    }
  }

  return undefined;
}
