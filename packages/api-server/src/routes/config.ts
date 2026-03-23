import express, { type Router } from 'express';
import {
  AgentManager,
  TeamConfigSchema,
  loadTeamConfig,
  saveTeamConfig,
  loadUserConfig,
  saveUserConfig,
  loadEnvFile,
  saveEnvFile,
  fetchGitHubModels,
  fetchOpenAICompatibleModels,
  fetchOpenAICompatibleModelsDetailed,
  type UserConfig,
  type ProviderConfig,
} from '@ai-team/core';

const OPENAI_KEY_FALLBACKS = ['AI_TEAM_LLM_API_KEY', 'LLM_API_KEY', 'OPENAI_API_KEY'] as const;

function getOpenAiKeyCandidates(apiKeyEnvVar?: string): string[] {
  if (apiKeyEnvVar && apiKeyEnvVar.trim()) {
    return [apiKeyEnvVar.trim(), ...OPENAI_KEY_FALLBACKS.filter((k) => k !== apiKeyEnvVar.trim())];
  }
  return [...OPENAI_KEY_FALLBACKS];
}

function resolveOpenAiApiKey(
  apiKeyEnvVar: string | undefined,
  envVars?: Record<string, string>,
): { keyName: string; value: string | undefined } {
  const candidates = getOpenAiKeyCandidates(apiKeyEnvVar);
  for (const keyName of candidates) {
    const value = envVars?.[keyName] ?? process.env[keyName];
    if (value) {
      return { keyName, value };
    }
  }
  return {
    keyName: candidates[0],
    value: undefined,
  };
}

export function createConfigRouter(workspaceRoot: string): Router {
  const router = express.Router();

  router.get('/', async (req: any, res: any, next: any) => {
    try {
      const config = await loadTeamConfig(workspaceRoot);
      res.json(config ?? { version: '1' });
    } catch (err) {
      next(err);
    }
  });

  router.put('/', async (req: any, res: any, next: any) => {
    try {
      const existing = await loadTeamConfig(workspaceRoot) ?? { version: '1' };
      const merged = { ...existing, ...req.body };
      const validated = TeamConfigSchema.parse(merged);
      await saveTeamConfig(workspaceRoot, validated);
      res.json(validated);
    } catch (err) {
      next(err);
    }
  });

  router.post('/providers/:providerRef/models/refresh', async (req: any, res: any, next: any) => {
    try {
      const { providerRef } = req.params;
      const config = await loadTeamConfig(workspaceRoot);
      const registry = config?.providers;
      const providerConfig = registry?.[providerRef];
      if (!providerConfig) {
        res.status(404).json({ error: `Provider '${providerRef}' not found` });
        return;
      }

      let fetchedModels: Array<{
        name: string;
        contextWindow?: number;
        maxPromptTokens?: number;
        maxContextWindowTokens?: number;
        maxOutputTokens?: number;
      }> = [];
      if (providerConfig.kind === 'github-copilot') {
        const models = await fetchGitHubModels();
        fetchedModels = models.map((m) => ({
          name: m.id,
          contextWindow: m.contextWindow,
          maxPromptTokens: m.maxPromptTokens,
          maxContextWindowTokens: m.maxContextWindowTokens,
          maxOutputTokens: m.maxOutputTokens,
        }));
      } else if (providerConfig.kind === 'openai-compatible' && providerConfig.baseUrl) {
        const envVars = await loadEnvFile(workspaceRoot);
        const apiKey = resolveOpenAiApiKey(providerConfig.apiKeyEnvVar, envVars).value;
        const models = await fetchOpenAICompatibleModelsDetailed(providerConfig.baseUrl, apiKey);
        fetchedModels = models.map((m) => ({
          name: m.id,
          contextWindow: m.contextWindow,
          maxPromptTokens: m.maxPromptTokens,
          maxContextWindowTokens: m.maxContextWindowTokens,
          maxOutputTokens: m.maxOutputTokens,
        }));
      }

      if (fetchedModels.length === 0) {
        res.status(502).json({
          error: `No models returned from provider '${providerRef}'. Check baseUrl and API key configuration.`,
        });
        return;
      }

      const existingModels = providerConfig.models ?? [];
      const mergedByName = new Map<string, {
        name: string;
        contextWindow?: number;
        maxPromptTokens?: number;
        maxContextWindowTokens?: number;
        maxOutputTokens?: number;
      }>();
      for (const existing of existingModels) {
        mergedByName.set(existing.name, { ...existing });
      }
      for (const fetched of fetchedModels) {
        const current = mergedByName.get(fetched.name);
        mergedByName.set(fetched.name, {
          ...(current ?? { name: fetched.name }),
          ...(typeof fetched.contextWindow === 'number' && fetched.contextWindow > 0
            ? { contextWindow: fetched.contextWindow }
            : {}),
          ...(typeof fetched.maxPromptTokens === 'number' && fetched.maxPromptTokens > 0
            ? { maxPromptTokens: fetched.maxPromptTokens }
            : {}),
          ...(typeof fetched.maxContextWindowTokens === 'number' && fetched.maxContextWindowTokens > 0
            ? { maxContextWindowTokens: fetched.maxContextWindowTokens }
            : {}),
          ...(typeof fetched.maxOutputTokens === 'number' && fetched.maxOutputTokens > 0
            ? { maxOutputTokens: fetched.maxOutputTokens }
            : {}),
        });
      }

      const newModels = [...mergedByName.values()];
      res.json(newModels);
    } catch (err) {
      next(err);
    }
  });

  router.get('/agent-model-keys', async (req: any, res: any, next: any) => {
    try {
      const mgr = new AgentManager(workspaceRoot);
      await mgr.loadAllAgents();
      const agents = mgr.getAllAgents();
      const keysByAgent: Record<string, string> = {};
      const usedKeySet = new Set<string>();

      for (const agent of agents) {
        if (agent.llm?.modelKey) {
          keysByAgent[agent.id] = agent.llm.modelKey;
          usedKeySet.add(agent.llm.modelKey);
        }
      }

      res.json({ usedKeys: [...usedKeySet], keysByAgent });
    } catch (err) {
      next(err);
    }
  });

  // ── User config (.ai-team/config.user.json) ─────────────────────────────────

  router.get('/user-config', async (req: any, res: any, next: any) => {
    try {
      const config = await loadUserConfig(workspaceRoot);
      res.json(config ?? {});
    } catch (err) {
      next(err);
    }
  });

  router.put('/user-config', async (req: any, res: any, next: any) => {
    try {
      const partial = (req.body ?? {}) as UserConfig;
      const saved = await saveUserConfig(workspaceRoot, partial);
      res.json(saved);
    } catch (err) {
      next(err);
    }
  });

  router.post('/user-config/providers/:providerRef/test', async (req: any, res: any, next: any) => {
    try {
      const { providerRef } = req.params;
      const devConfig = await loadUserConfig(workspaceRoot);
      const providerConfig = devConfig?.providers?.[providerRef];
      if (!providerConfig) {
        res.status(404).json({ error: `Provider '${providerRef}' not found in user config` });
        return;
      }

      const start = Date.now();
      try {
        if (providerConfig.kind === 'github-copilot') {
          await fetchGitHubModels();
        } else if (providerConfig.kind === 'openai-compatible' && providerConfig.baseUrl) {
          const envVars = await loadEnvFile(workspaceRoot);
          const apiKey = resolveOpenAiApiKey(providerConfig.apiKeyEnvVar, envVars).value;
          await fetchOpenAICompatibleModels(providerConfig.baseUrl, apiKey);
        } else {
          res.json({ ok: false, error: 'Cannot test: missing baseUrl or unsupported kind' });
          return;
        }
        res.json({ ok: true, latencyMs: Date.now() - start });
      } catch (connErr) {
        res.json({ ok: false, latencyMs: Date.now() - start, error: String((connErr as Error).message ?? connErr) });
      }
    } catch (err) {
      next(err);
    }
  });

  router.post('/user-config/providers/:providerRef/models/refresh', async (req: any, res: any, next: any) => {
    try {
      const { providerRef } = req.params;
      const devConfig = await loadUserConfig(workspaceRoot);
      const providerConfig = devConfig?.providers?.[providerRef];
      if (!providerConfig) {
        res.status(404).json({ error: `Provider '${providerRef}' not found in user config` });
        return;
      }

      let fetchedModels: Array<{
        name: string;
        contextWindow?: number;
        maxPromptTokens?: number;
        maxContextWindowTokens?: number;
        maxOutputTokens?: number;
      }> = [];
      if (providerConfig.kind === 'github-copilot') {
        const models = await fetchGitHubModels();
        fetchedModels = models.map((m: {
          id: string;
          contextWindow?: number;
          maxPromptTokens?: number;
          maxContextWindowTokens?: number;
          maxOutputTokens?: number;
        }) => ({
          name: m.id,
          contextWindow: m.contextWindow,
          maxPromptTokens: m.maxPromptTokens,
          maxContextWindowTokens: m.maxContextWindowTokens,
          maxOutputTokens: m.maxOutputTokens,
        }));
      } else if (providerConfig.kind === 'openai-compatible' && providerConfig.baseUrl) {
        const envVars = await loadEnvFile(workspaceRoot);
        const apiKey = resolveOpenAiApiKey(providerConfig.apiKeyEnvVar, envVars).value;
        const models = await fetchOpenAICompatibleModelsDetailed(providerConfig.baseUrl, apiKey);
        fetchedModels = models.map((m) => ({
          name: m.id,
          contextWindow: m.contextWindow,
          maxPromptTokens: m.maxPromptTokens,
          maxContextWindowTokens: m.maxContextWindowTokens,
          maxOutputTokens: m.maxOutputTokens,
        }));
      }

      if (fetchedModels.length === 0) {
        const providerPatch: Record<string, ProviderConfig> = {};
        if (devConfig?.providers) {
          Object.assign(providerPatch, devConfig.providers);
        }
        providerPatch[providerRef] = {
          ...providerConfig,
          modelDiscovery: {
            ...(providerConfig.modelDiscovery ?? {}),
            lastRefreshedAt: new Date().toISOString(),
            lastRefreshStatus: 'error',
            lastRefreshError: `No models returned from provider '${providerRef}'. Check baseUrl and API key configuration.`,
          },
        };
        await saveUserConfig(workspaceRoot, { providers: providerPatch });

        res.status(502).json({
          error: `No models returned from provider '${providerRef}'. Check baseUrl and API key configuration.`,
        });
        return;
      }

      const existingModels = providerConfig.models ?? [];
      const mergedByName = new Map<string, {
        name: string;
        contextWindow?: number;
        maxPromptTokens?: number;
        maxContextWindowTokens?: number;
        maxOutputTokens?: number;
      }>();
      for (const existing of existingModels) {
        mergedByName.set(existing.name, { ...existing });
      }
      for (const fetched of fetchedModels) {
        const current = mergedByName.get(fetched.name);
        mergedByName.set(fetched.name, {
          ...(current ?? { name: fetched.name }),
          ...(typeof fetched.contextWindow === 'number' && fetched.contextWindow > 0
            ? { contextWindow: fetched.contextWindow }
            : {}),
          ...(typeof fetched.maxPromptTokens === 'number' && fetched.maxPromptTokens > 0
            ? { maxPromptTokens: fetched.maxPromptTokens }
            : {}),
          ...(typeof fetched.maxContextWindowTokens === 'number' && fetched.maxContextWindowTokens > 0
            ? { maxContextWindowTokens: fetched.maxContextWindowTokens }
            : {}),
          ...(typeof fetched.maxOutputTokens === 'number' && fetched.maxOutputTokens > 0
            ? { maxOutputTokens: fetched.maxOutputTokens }
            : {}),
        });
      }

      const mergedModels = [...mergedByName.values()];

      const providerPatch: Record<string, ProviderConfig> = {};
      if (devConfig?.providers) {
        Object.assign(providerPatch, devConfig.providers);
      }
      providerPatch[providerRef] = {
        ...providerConfig,
        models: mergedModels,
        defaultModel: providerConfig.defaultModel ?? mergedModels[0]?.name,
        modelDiscovery: {
          ...(providerConfig.modelDiscovery ?? {}),
          lastRefreshedAt: new Date().toISOString(),
          lastRefreshStatus: 'ok',
          lastRefreshError: undefined,
        },
      };

      await saveUserConfig(workspaceRoot, { providers: providerPatch });

      res.json({ models: mergedModels });
    } catch (err) {
      next(err);
    }
  });

  // ── Environment variable management ────────────────────────────────────────

  router.get('/env-status', async (req: any, res: any, next: any) => {
    try {
      const envVars = await loadEnvFile(workspaceRoot);
      const teamConfig = await loadTeamConfig(workspaceRoot);
      const devConfig = await loadUserConfig(workspaceRoot);

      const allProviders: Array<{ kind?: string; apiKeyEnvVar?: string }> = [
        ...Object.values(teamConfig?.providers ?? {}),
        ...Object.values(devConfig?.providers ?? {}),
      ];

      const status: Record<string, boolean> = {};
      for (const provider of allProviders) {
        if (provider.kind === 'github-copilot') {
          continue;
        }

        if (provider.kind === 'openai-compatible') {
          const candidates = getOpenAiKeyCandidates(provider.apiKeyEnvVar);
          const primary = candidates[0];
          status[primary] = candidates.some((keyName) => Boolean(envVars[keyName] || process.env[keyName]));
          continue;
        }

        if (provider.apiKeyEnvVar) {
          const keyName = provider.apiKeyEnvVar;
          status[keyName] = !!(envVars[keyName] || process.env[keyName]);
        }
      }

      res.json(status);
    } catch (err) {
      next(err);
    }
  });

  router.put('/env-key', async (req: any, res: any, next: any) => {
    try {
      const { key, value } = req.body as { key: string; value: string };
      if (!key || typeof key !== 'string' || !key.trim()) {
        res.status(400).json({ error: 'key is required' });
        return;
      }
      if (typeof value !== 'string') {
        res.status(400).json({ error: 'value must be a string' });
        return;
      }
      const existing = await loadEnvFile(workspaceRoot);
      existing[key.trim()] = value;
      await saveEnvFile(workspaceRoot, existing);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
