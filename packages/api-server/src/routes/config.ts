import express, { type Router } from 'express';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AgentManager,
  TeamConfigSchema,
  loadTeamConfig,
  saveTeamConfig,
  loadEnvFile,
  saveEnvFile,
  fetchGitHubModels,
  fetchOpenAICompatibleModels,
  fetchOpenAICompatibleModelsDetailed,
} from '@ai-team/core';

interface DeveloperProviderConfig {
  kind: string;
  isDefault?: boolean;
  model?: string;
  defaultModel?: string;
  models?: Array<{
    name: string;
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  }>;
  baseUrl?: string;
  apiKeyEnvVar?: string;
  contextWindow?: number;
  modelDiscovery?: {
    lastRefreshedAt?: string;
    lastRefreshStatus?: 'ok' | 'error';
    lastRefreshError?: string;
  };
}

interface DeveloperModelKeyEntry {
  provider: string;
  model: string;
  contextWindow?: number;
}

interface DeveloperSystemModelEntry {
  provider?: string;
  modelKey?: string;
  model?: string;
  contextWindow?: number;
}

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

interface DeveloperConfig {
  developer?: {
    id?: string;
    name?: string;
    email?: string;
    avatar?: string;
    portfolioUrl?: string;
  };
  llm?: {
    defaultLlmProvider?: string;
    providers?: Record<string, DeveloperProviderConfig>;
    modelKeys?: Record<string, DeveloperModelKeyEntry>;
    systemModels?: Record<string, DeveloperSystemModelEntry>;
  };
}

function getDeveloperConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, '.ai-team', 'config.developer.json');
}

function normalizeDeveloperConfig(raw: DeveloperConfig): DeveloperConfig {
  const developer: NonNullable<DeveloperConfig['developer']> = {};
  if (raw.developer) {
    Object.assign(developer, raw.developer);
  }

  const llm: NonNullable<DeveloperConfig['llm']> = {};
  if (raw.llm) {
    Object.assign(llm, raw.llm);
  }

  return {
    ...(Object.keys(developer).length > 0 ? { developer } : {}),
    ...(Object.keys(llm).length > 0 ? { llm } : {}),
  };
}

async function loadDeveloperConfigLocal(workspaceRoot: string): Promise<DeveloperConfig | undefined> {
  const configPath = getDeveloperConfigPath(workspaceRoot);
  try {
    const content = await readFile(configPath, 'utf-8');
    return normalizeDeveloperConfig(JSON.parse(content) as DeveloperConfig);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function saveDeveloperConfigLocal(workspaceRoot: string, partial: DeveloperConfig): Promise<DeveloperConfig> {
  const existing = normalizeDeveloperConfig((await loadDeveloperConfigLocal(workspaceRoot)) ?? {});
  const incoming = normalizeDeveloperConfig(partial);

  let mergedProviders: Record<string, DeveloperProviderConfig> | undefined;
  if (existing.llm?.providers || incoming.llm?.providers) {
    mergedProviders = {};
    if (existing.llm?.providers) {
      Object.assign(mergedProviders, existing.llm.providers);
    }
    if (incoming.llm?.providers) {
      Object.assign(mergedProviders, incoming.llm.providers);
    }
  }

  let mergedDeveloper: NonNullable<DeveloperConfig['developer']> | undefined;
  if (existing.developer || incoming.developer) {
    mergedDeveloper = {};
    if (existing.developer) {
      Object.assign(mergedDeveloper, existing.developer);
    }
    if (incoming.developer) {
      Object.assign(mergedDeveloper, incoming.developer);
    }
  }

  let mergedLlm: NonNullable<DeveloperConfig['llm']> | undefined;
  if (existing.llm || incoming.llm) {
    mergedLlm = {};
    if (existing.llm) {
      Object.assign(mergedLlm, existing.llm);
    }
    if (incoming.llm) {
      Object.assign(mergedLlm, incoming.llm);
    }
    if (mergedProviders) {
      mergedLlm.providers = mergedProviders;
    }
  }

  const merged: DeveloperConfig = {
    ...(mergedDeveloper ? { developer: mergedDeveloper } : {}),
    ...(mergedLlm ? { llm: mergedLlm } : {}),
  };
  const configPath = getDeveloperConfigPath(workspaceRoot);
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
  return merged;
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

      // Build result: existing models preserved, fetched models update/add entries.
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

  // ── Developer config (.ai-team/config.developer.json) ─────────────────────

  router.get('/developer-config', async (req: any, res: any, next: any) => {
    try {
      const config = await loadDeveloperConfigLocal(workspaceRoot);
      res.json(config ?? {});
    } catch (err) {
      next(err);
    }
  });

  router.put('/developer-config', async (req: any, res: any, next: any) => {
    try {
      const partial = (req.body ?? {}) as DeveloperConfig;
      const saved = await saveDeveloperConfigLocal(workspaceRoot, partial);
      res.json(saved);
    } catch (err) {
      next(err);
    }
  });

  // Test connection for a provider in config.developer.json
  router.post('/developer-config/providers/:providerRef/test', async (req: any, res: any, next: any) => {
    try {
      const { providerRef } = req.params;
      const devConfig = await loadDeveloperConfigLocal(workspaceRoot);
      const providerConfig = devConfig?.llm?.providers?.[providerRef];
      if (!providerConfig) {
        res.status(404).json({ error: `Provider '${providerRef}' not found in developer config` });
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

  // Refresh available models for a provider in config.developer.json
  router.post('/developer-config/providers/:providerRef/models/refresh', async (req: any, res: any, next: any) => {
    try {
      const { providerRef } = req.params;
      const devConfig = await loadDeveloperConfigLocal(workspaceRoot);
      const providerConfig = devConfig?.llm?.providers?.[providerRef];
      if (!providerConfig) {
        res.status(404).json({ error: `Provider '${providerRef}' not found in developer config` });
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
        const llmPatch: NonNullable<DeveloperConfig['llm']> = {};
        if (devConfig?.llm) {
          Object.assign(llmPatch, devConfig.llm);
        }
        const providerPatch: Record<string, DeveloperProviderConfig> = {};
        if (devConfig?.llm?.providers) {
          Object.assign(providerPatch, devConfig.llm.providers);
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
        llmPatch.providers = providerPatch;
        await saveDeveloperConfigLocal(workspaceRoot, { llm: llmPatch });

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

      const llmPatch: NonNullable<DeveloperConfig['llm']> = {};
      if (devConfig?.llm) {
        Object.assign(llmPatch, devConfig.llm);
      }
      const providerPatch: Record<string, DeveloperProviderConfig> = {};
      if (devConfig?.llm?.providers) {
        Object.assign(providerPatch, devConfig.llm.providers);
      }
      providerPatch[providerRef] = {
        ...providerConfig,
        models: mergedModels,
        defaultModel: providerConfig.defaultModel ?? providerConfig.model ?? mergedModels[0]?.name,
        modelDiscovery: {
          ...(providerConfig.modelDiscovery ?? {}),
          lastRefreshedAt: new Date().toISOString(),
          lastRefreshStatus: 'ok',
          lastRefreshError: undefined,
        },
      };
      llmPatch.providers = providerPatch;

      await saveDeveloperConfigLocal(workspaceRoot, { llm: llmPatch });

      res.json({ models: mergedModels });
    } catch (err) {
      next(err);
    }
  });

  // ── Environment variable management ────────────────────────────────────────

  // Returns which env var keys are set (without exposing values)
  router.get('/env-status', async (req: any, res: any, next: any) => {
    try {
      const envVars = await loadEnvFile(workspaceRoot);
      const teamConfig = await loadTeamConfig(workspaceRoot);
      const devConfig = await loadDeveloperConfigLocal(workspaceRoot);

      const allProviders: Array<{ kind?: string; apiKeyEnvVar?: string }> = [
        ...Object.values(teamConfig?.providers ?? {}),
        ...Object.values(devConfig?.llm?.providers ?? {}),
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

  // Set (or update) a single env var in .ai-team/.env
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
