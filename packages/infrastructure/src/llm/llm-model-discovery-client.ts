import { execSync } from 'node:child_process';

const GITHUB_COPILOT_MODELS_URL = 'https://api.individual.githubcopilot.com/models';
const GITHUB_TOKEN_TIMEOUT_MS = 15_000;
const MODEL_FETCH_TIMEOUT_MS = 15_000;

interface CopilotModel {
  id: string;
  name: string;
  capabilities: {
    family: string;
    type: string;
    limits?: {
      max_context_window_tokens?: number;
      max_prompt_tokens?: number;
      max_output_tokens?: number;
    };
  };
}

interface OpenAiCompatibleModel {
  id: string;
  object?: string;
  context_window?: number;
  input_token_limit?: number;
  output_token_limit?: number;
  max_context_window_tokens?: number;
  max_prompt_tokens?: number;
  max_output_tokens?: number;
  capabilities?: {
    limits?: {
      max_context_window_tokens?: number;
      max_prompt_tokens?: number;
      max_output_tokens?: number;
    };
  };
  context_length?: number;
  max_input_tokens?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  token_limits?: {
    context_window?: number;
    max_context_window_tokens?: number;
    max_prompt_tokens?: number;
    max_output_tokens?: number;
    max_input_tokens?: number;
    max_completion_tokens?: number;
  };
}

export interface DiscoveredProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
}

const COPILOT_MODEL_FALLBACK: DiscoveredProviderModel[] = [
  { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 68_000, maxPromptTokens: 68_000 },
  { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 68_000, maxPromptTokens: 68_000 },
  {
    id: 'claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    contextWindow: 128_000,
    maxPromptTokens: 128_000,
  },
  {
    id: 'claude-3.7-sonnet',
    name: 'Claude 3.7 Sonnet',
    contextWindow: 128_000,
    maxPromptTokens: 128_000,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    contextWindow: 144_000,
    maxPromptTokens: 144_000,
  },
  {
    id: 'claude-sonnet-4.6',
    name: 'Claude Sonnet 4.6',
    contextWindow: 160_000,
    maxPromptTokens: 160_000,
  },
  { id: 'o1', name: 'o1', contextWindow: 128_000, maxPromptTokens: 128_000 },
  { id: 'o1-mini', name: 'o1-mini', contextWindow: 128_000, maxPromptTokens: 128_000 },
  { id: 'o3-mini', name: 'o3-mini', contextWindow: 128_000, maxPromptTokens: 128_000 },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    contextWindow: 173_000,
    maxPromptTokens: 173_000,
  },
].sort((a, b) => a.name.localeCompare(b.name));

export class LlmModelDiscoveryClient {
  async fetchGitHubModels(): Promise<DiscoveredProviderModel[]> {
    try {
      const token = this.getGitHubToken();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MODEL_FETCH_TIMEOUT_MS);
      const res = await fetch(GITHUB_COPILOT_MODELS_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) return COPILOT_MODEL_FALLBACK;

      const body = (await res.json()) as { data: CopilotModel[] };
      const models = body.data || [];

      const unique = new Map<string, DiscoveredProviderModel>();
      for (const m of models) {
        if (m.capabilities?.type !== 'chat') continue;
        if (m.capabilities.family.startsWith('goldeneye')) continue;

        const maxPromptTokens = m.capabilities?.limits?.max_prompt_tokens;
        const maxContextWindowTokens = m.capabilities?.limits?.max_context_window_tokens;
        const maxOutputTokens = m.capabilities?.limits?.max_output_tokens;
        const contextWindow = maxPromptTokens ?? maxContextWindowTokens;

        if (!unique.has(m.id)) {
          unique.set(m.id, {
            id: m.id,
            name: m.name,
            contextWindow,
            maxPromptTokens,
            maxContextWindowTokens,
            maxOutputTokens,
          });
        }
      }

      const resolved = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
      return resolved.length > 0 ? resolved : COPILOT_MODEL_FALLBACK;
    } catch {
      return COPILOT_MODEL_FALLBACK;
    }
  }

  async fetchOpenAICompatibleModels(baseUrl: string, apiKey?: string): Promise<string[]> {
    const detailed = await this.fetchOpenAICompatibleModelsDetailed(baseUrl, apiKey);
    return detailed.map((m) => m.id);
  }

  async fetchOpenAICompatibleModelsDetailed(
    baseUrl: string,
    apiKey?: string
  ): Promise<DiscoveredProviderModel[]> {
    const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const stripped = normalized
      .replace(/\/?chat\/completions$/i, '')
      .replace(/\/?responses$/i, '')
      .replace(/\/?completions$/i, '');

    const endpointCandidates = this.getOpenAiModelsEndpointCandidates(stripped);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const tryExtractModel = (model: OpenAiCompatibleModel): DiscoveredProviderModel | undefined => {
      if (typeof model.id !== 'string' || model.id.trim().length === 0) {
        return undefined;
      }

      const id = model.id.trim();
      const extracted = this.extractOpenAiLimitMetadata(model);

      return {
        id,
        name: id,
        contextWindow: extracted.contextWindow,
        maxPromptTokens: extracted.maxPromptTokens,
        maxContextWindowTokens: extracted.maxContextWindowTokens,
        maxOutputTokens: extracted.maxOutputTokens,
      };
    };

    for (const url of endpointCandidates) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MODEL_FETCH_TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: 'GET',
          headers,
          signal: controller.signal,
        });

        if (!res.ok) continue;

        const body = (await res.json()) as { data?: OpenAiCompatibleModel[] };
        const listed = (body.data || [])
          .map((model) => tryExtractModel(model))
          .filter((model): model is DiscoveredProviderModel => Boolean(model));

        if (listed.length > 0) {
          const enriched = await this.enrichOpenAiModelLimits(url, listed, headers);
          return [...enriched].sort((a, b) => a.name.localeCompare(b.name));
        }
      } catch {
        // try next endpoint
      } finally {
        clearTimeout(timer);
      }
    }

    return [];
  }

  private getGitHubToken(): string {
    try {
      const token = execSync('gh auth token', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: GITHUB_TOKEN_TIMEOUT_MS,
      }).trim();
      if (!token) throw new Error('gh auth token returned empty');
      return token;
    } catch (error) {
      throw new Error(
        'Could not get GitHub token. Make sure the GitHub CLI is installed and authenticated:\n' +
          '  1. Install: https://cli.github.com\n' +
          '  2. Login:   gh auth login\n' +
          (error instanceof Error ? `\nDetails: ${error.message}` : '')
      );
    }
  }

  private toPositiveInt(value: unknown): number | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : undefined;
  }

  private getOpenAiModelsEndpointCandidates(strippedBaseUrl: string): string[] {
    const endpointCandidates: string[] = [];
    const pushCandidate = (url: string) => {
      if (!endpointCandidates.includes(url)) endpointCandidates.push(url);
    };

    pushCandidate(`${strippedBaseUrl}/models`);

    try {
      const parsed = new URL(strippedBaseUrl);
      pushCandidate(`${parsed.origin}/v1/models`);
      pushCandidate(`${parsed.origin}/models`);
    } catch {
      // ignore parse failures
    }

    return endpointCandidates;
  }

  private async enrichOpenAiModelLimits(
    listEndpoint: string,
    listedModels: DiscoveredProviderModel[],
    headers: Record<string, string>
  ): Promise<DiscoveredProviderModel[]> {
    const withLimits = listedModels.filter(
      (m) => m.maxPromptTokens || m.maxContextWindowTokens || m.maxOutputTokens
    );
    if (withLimits.length > 0) return listedModels;

    const detailCandidates = listedModels
      .filter((m) => /^(gpt|o\d|chatgpt)/i.test(m.id))
      .slice(0, 30);
    if (detailCandidates.length === 0) return listedModels;

    const base = listEndpoint.endsWith('/models')
      ? listEndpoint
      : `${listEndpoint.replace(/\/$/, '')}/models`;
    const out = new Map(listedModels.map((m) => [m.id, { ...m }]));

    await Promise.all(
      detailCandidates.map(async (model) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.min(MODEL_FETCH_TIMEOUT_MS, 5_000));
        try {
          const response = await fetch(`${base}/${encodeURIComponent(model.id)}`, {
            method: 'GET',
            headers,
            signal: controller.signal,
          });
          if (!response.ok) return;

          const details = (await response.json()) as OpenAiCompatibleModel;
          const extracted = this.extractOpenAiLimitMetadata(details);
          const maxPromptTokens = extracted.maxPromptTokens;
          const maxContextWindowTokens = extracted.maxContextWindowTokens;
          const maxOutputTokens = extracted.maxOutputTokens;

          if (!maxPromptTokens && !maxContextWindowTokens && !maxOutputTokens) return;

          out.set(model.id, {
            ...model,
            contextWindow: extracted.contextWindow ?? model.contextWindow,
            maxPromptTokens: maxPromptTokens ?? model.maxPromptTokens,
            maxContextWindowTokens: maxContextWindowTokens ?? model.maxContextWindowTokens,
            maxOutputTokens: maxOutputTokens ?? model.maxOutputTokens,
          });
        } catch {
          // best effort
        } finally {
          clearTimeout(timer);
        }
      })
    );

    return [...out.values()];
  }

  private extractOpenAiLimitMetadata(model: OpenAiCompatibleModel): {
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  } {
    const modelRecord = model as unknown as Record<string, unknown>;
    const tokenLimits = modelRecord.token_limits as Record<string, unknown> | undefined;
    const capabilities = modelRecord.capabilities as Record<string, unknown> | undefined;
    const capabilitiesLimits = capabilities?.limits as Record<string, unknown> | undefined;

    const maxPromptTokens =
      this.toPositiveInt(modelRecord.max_prompt_tokens) ??
      this.toPositiveInt(modelRecord.input_token_limit) ??
      this.toPositiveInt(modelRecord.max_input_tokens) ??
      this.toPositiveInt(tokenLimits?.max_prompt_tokens) ??
      this.toPositiveInt(tokenLimits?.max_input_tokens) ??
      this.toPositiveInt(capabilitiesLimits?.max_prompt_tokens);

    const maxContextWindowTokens =
      this.toPositiveInt(modelRecord.max_context_window_tokens) ??
      this.toPositiveInt(modelRecord.context_window) ??
      this.toPositiveInt(modelRecord.context_length) ??
      this.toPositiveInt(tokenLimits?.max_context_window_tokens) ??
      this.toPositiveInt(tokenLimits?.context_window) ??
      this.toPositiveInt(capabilitiesLimits?.max_context_window_tokens);

    const maxOutputTokens =
      this.toPositiveInt(modelRecord.max_output_tokens) ??
      this.toPositiveInt(modelRecord.output_token_limit) ??
      this.toPositiveInt(modelRecord.max_completion_tokens) ??
      this.toPositiveInt(tokenLimits?.max_output_tokens) ??
      this.toPositiveInt(tokenLimits?.max_completion_tokens) ??
      this.toPositiveInt(capabilitiesLimits?.max_output_tokens);

    return {
      contextWindow: maxPromptTokens ?? maxContextWindowTokens,
      maxPromptTokens,
      maxContextWindowTokens,
      maxOutputTokens,
    };
  }
}
