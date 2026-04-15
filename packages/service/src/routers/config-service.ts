import type {
  IConfigService,
  UserConfig,
  TeamConfig,
  GetMcpServersResponse,
  UpdateMcpServerResponse,
} from '@ai-team/api-client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AgentManager,
  loadTeamConfig,
  saveTeamConfig,
  loadUserConfig,
  saveUserConfig,
  loadEnvFile,
  saveEnvFile,
} from '@ai-team/infrastructure';
import { TeamConfigSchema } from '@ai-team/core';
import { BadRequestError } from '../http-errors.js';

export class ConfigService implements IConfigService {
  constructor(private readonly workspaceRoot: string) {}

  async getConfig(): Promise<TeamConfig> {
    return (await loadTeamConfig(this.workspaceRoot)) ?? TeamConfigSchema.parse({ version: '1' });
  }

  async updateConfig(body: Partial<TeamConfig>): Promise<TeamConfig> {
    const existing =
      (await loadTeamConfig(this.workspaceRoot)) ?? TeamConfigSchema.parse({ version: '1' });
    const merged = { ...existing, ...body } as TeamConfig;
    await saveTeamConfig(this.workspaceRoot, merged as any);
    return merged;
  }

  async getAgentModelKeys(): Promise<{ usedKeys: string[]; keysByAgent: Record<string, string> }> {
    const mgr = new AgentManager(this.workspaceRoot);
    await mgr.refreshAsync();
    const agents = await mgr.getAllAgentsAsync();
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
    return (await loadUserConfig(this.workspaceRoot)) ?? {};
  }

  async saveUserConfig(body: Partial<UserConfig>): Promise<UserConfig> {
    return saveUserConfig(this.workspaceRoot, body as any);
  }

  async testProviderConnection(
    providerRef: string
  ): Promise<{ ok: boolean; latencyMs?: number; error?: string; message?: string }> {
    return {
      ok: false,
      error: `testProviderConnection not supported in-process for '${providerRef}'`,
    };
  }

  async refreshUserProviderModels(providerRef: string): Promise<unknown> {
    const config = await loadUserConfig(this.workspaceRoot);
    return (config as any)?.providers?.[providerRef]?.models ?? [];
  }

  async refreshProviderModels(providerRef: string): Promise<unknown> {
    const config = await loadTeamConfig(this.workspaceRoot);
    return (config as any)?.providers?.[providerRef]?.models ?? [];
  }

  async getEnvStatus(): Promise<Record<string, boolean>> {
    const envVars = await loadEnvFile(this.workspaceRoot);
    const teamConfig = await loadTeamConfig(this.workspaceRoot);
    const userConfig = await loadUserConfig(this.workspaceRoot);
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
    const existing = await loadEnvFile(this.workspaceRoot);
    existing[body.key] = body.value;
    await saveEnvFile(this.workspaceRoot, existing);
    return { ok: true };
  }

  async getMcpServers(query?: { agent?: string }): Promise<GetMcpServersResponse> {
    const config = await loadTeamConfig(this.workspaceRoot);
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
      const mgr = new AgentManager(this.workspaceRoot);
      await mgr.refreshAsync();
      const agent = await mgr.getAgentAsync(query.agent);
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
    const mgr = new AgentManager(this.workspaceRoot);
    await mgr.refreshAsync();
    const agent = await mgr.getAgentAsync(body.agent);
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
      await mgr.updateAgentAsync(agent.id, {
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
    const mgr = new AgentManager(this.workspaceRoot);
    await mgr.refreshAsync();
    const agent = await mgr.getAgentAsync(body.agent);
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
      await mgr.updateAgentAsync(agent.id, {
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
