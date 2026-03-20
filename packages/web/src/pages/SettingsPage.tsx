import { useState, useEffect, type ReactNode } from 'react';
import {
  useConfig, useSaveConfig, useAgentModelKeys,
  useDeveloperConfig, useSaveDeveloperConfig,
  useTestProviderConnection, useEnvStatus, useSetEnvVar,
  useRefreshDevProviderModels,
} from '../hooks/useConfig';
import type { TeamConfig, DeveloperConfig, ProviderConfig, ModelKeyEntry } from '../hooks/useConfig';
import { SYSTEM_MODEL_KEY_LABELS } from './settingsConstants';
import './SettingsPage.css';

const DEFAULT_CONTEXT_WINDOW = 128_000;

// ─────────────────────────────────────────────────────────────────────────────
// Developer Settings — reads/writes config.developer.json + .ai-team/.env
// ─────────────────────────────────────────────────────────────────────────────

function getDeveloperProviders(config: DeveloperConfig): Record<string, ProviderConfig> {
  return config.llm?.providers ?? {};
}

function getDeveloperProfile(config: DeveloperConfig): NonNullable<DeveloperConfig['developer']> {
  return {
    id: config.developer?.id,
    name: config.developer?.name,
    email: config.developer?.email,
    avatar: config.developer?.avatar,
    portfolioUrl: config.developer?.portfolioUrl,
  };
}

function getDeveloperModelKeys(config: DeveloperConfig): Record<string, ModelKeyEntry> {
  return config.llm?.modelKeys ?? {};
}

function getDeveloperSystemModels(config: DeveloperConfig): Record<string, { provider?: string; modelKey?: string; model?: string; contextWindow?: number }> {
  return config.llm?.systemModels ?? {};
}

function getDefaultProviderRef(config: DeveloperConfig, providers: Record<string, ProviderConfig>): string | undefined {
  const fromLlm = config.llm?.defaultLlmProvider;
  if (fromLlm && providers[fromLlm]) {
    return fromLlm;
  }

  const fromFlag = Object.entries(providers).find(([, p]) => p.isDefault)?.[0];
  if (fromFlag) {
    return fromFlag;
  }

  return Object.keys(providers)[0];
}

function setDeveloperProviders(config: DeveloperConfig, providers: Record<string, ProviderConfig>): DeveloperConfig {
  const nextLlm = config.llm ? { ...config.llm } : {};
  nextLlm.providers = providers;
  return {
    ...config,
    llm: nextLlm,
  };
}

function setDeveloperProfile(config: DeveloperConfig, profile: NonNullable<DeveloperConfig['developer']>): DeveloperConfig {
  return {
    ...config,
    developer: profile,
  };
}

function setDeveloperModelKeys(config: DeveloperConfig, modelKeys: Record<string, ModelKeyEntry>): DeveloperConfig {
  const nextLlm = config.llm ? { ...config.llm } : {};
  nextLlm.modelKeys = modelKeys;
  return {
    ...config,
    llm: nextLlm,
  };
}

function setDeveloperSystemModels(
  config: DeveloperConfig,
  systemModels: Record<string, { provider?: string; modelKey?: string; model?: string; contextWindow?: number }>,
): DeveloperConfig {
  const nextLlm = config.llm ? { ...config.llm } : {};
  nextLlm.systemModels = systemModels;
  return {
    ...config,
    llm: nextLlm,
  };
}

function setDeveloperDefaultProvider(config: DeveloperConfig, defaultLlmProvider?: string): DeveloperConfig {
  const nextLlm = config.llm ? { ...config.llm } : {};
  nextLlm.defaultLlmProvider = defaultLlmProvider;

  const providers = getDeveloperProviders(config);
  if (Object.keys(providers).length > 0) {
    const nextProviders: Record<string, ProviderConfig> = {};
    for (const [ref, provider] of Object.entries(providers)) {
      nextProviders[ref] = {
        ...provider,
        isDefault: defaultLlmProvider ? ref === defaultLlmProvider : provider.isDefault,
      };
    }
    nextLlm.providers = nextProviders;
  }

  return {
    ...config,
    llm: nextLlm,
  };
}

function getProviderModelIds(provider: ProviderConfig | undefined): string[] {
  return getProviderModels(provider).map((model) => model.name);
}

function getProviderModels(provider: ProviderConfig | undefined): Array<{
  name: string;
  contextWindow?: number;
  maxPromptTokens?: number;
  maxContextWindowTokens?: number;
  maxOutputTokens?: number;
}> {
  if (!provider) return [];

  const normalized: Array<{
    name: string;
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  }> = [];
  const seen = new Set<string>();

  for (const model of provider.models ?? []) {
    if (!model?.name || seen.has(model.name)) continue;
    seen.add(model.name);
    normalized.push({
      name: model.name,
      contextWindow: model.contextWindow,
      maxPromptTokens: model.maxPromptTokens,
      maxContextWindowTokens: model.maxContextWindowTokens,
      maxOutputTokens: model.maxOutputTokens,
    });
  }

  if (provider.model && !seen.has(provider.model)) {
    normalized.push({
      name: provider.model,
    });
  }

  return normalized;
}

function setProviderModels(
  provider: ProviderConfig,
  models: Array<{
    name: string;
    contextWindow?: number;
    maxPromptTokens?: number;
    maxContextWindowTokens?: number;
    maxOutputTokens?: number;
  }>,
): ProviderConfig {
  return {
    ...provider,
    models,
  };
}

function getProviderModelOptions(provider: ProviderConfig | undefined): Array<{ name: string; modelId: string }> {
  return getProviderModels(provider).map((model) => ({
    name: model.name,
    modelId: model.name,
  }));
}

function formatTokens(value: number | undefined): string | undefined {
  if (!value || value <= 0) return undefined;
  if (value >= 1_000_000) {
    const compact = value / 1_000_000;
    return `${Number.isInteger(compact) ? compact : compact.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const compact = value / 1_000;
    return `${Number.isInteger(compact) ? compact : compact.toFixed(1)}K`;
  }
  return String(value);
}

function formatDateTime(value: string | undefined): string {
  if (!value) return 'Never';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function setDefaultModelForProvider(
  config: DeveloperConfig,
  providerRef: string | undefined,
  modelId: string | undefined,
): DeveloperConfig {
  if (!providerRef || !modelId) {
    return config;
  }

  const providers = getDeveloperProviders(config);
  const provider = providers[providerRef];
  if (!provider) {
    return config;
  }

  const models = [...getProviderModels(provider)];
  const exists = models.some((entry) => entry.name === modelId);
  if (!exists) {
    models.push({ name: modelId });
  }

  return setDeveloperProviders(config, {
    ...providers,
    [providerRef]: {
      ...setProviderModels(provider, models),
      model: modelId,
      defaultModel: modelId,
    },
  });
}

function getProviderContextWindow(provider: ProviderConfig | undefined, modelId?: string): number {
  if (!provider) {
    return DEFAULT_CONTEXT_WINDOW;
  }

  if (modelId) {
    const model = getProviderModels(provider).find((m) => m.name === modelId);
    const explicit = model?.contextWindow
      ?? model?.maxPromptTokens
      ?? model?.maxContextWindowTokens;
    if (typeof explicit === 'number' && explicit > 0) {
      return explicit;
    }
  }

  if (typeof provider.contextWindow === 'number' && provider.contextWindow > 0) {
    return provider.contextWindow;
  }

  return DEFAULT_CONTEXT_WINDOW;
}

interface ApiKeyFieldProps {
  envVarName: string;
  isSet: boolean;
  onSave: (value: string) => void;
  saving: boolean;
}

function ApiKeyField({ envVarName, isSet, onSave, saving }: Readonly<ApiKeyFieldProps>) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');

  const handleSave = () => {
    if (value.trim()) {
      onSave(value.trim());
      setValue('');
      setEditing(false);
    }
  };

  return (
    <div className="api-key-field">
      <span className={`api-key-status ${isSet ? 'api-key-status--set' : 'api-key-status--missing'}`}>
        {isSet ? '✓' : '✗'}
      </span>
      <code className="api-key-varname">{envVarName}</code>
      {isSet && !editing && (
        <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(true)}>
          Update
        </button>
      )}
      {(!isSet || editing) && (
        <>
          <input
            type="password"
            className="api-key-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste API key…"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button type="button" className="btn-primary btn-sm" onClick={handleSave} disabled={saving || !value.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {editing && (
            <button type="button" className="btn-secondary btn-sm" onClick={() => { setEditing(false); setValue(''); }}>
              Cancel
            </button>
          )}
        </>
      )}
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

function CollapsibleSection({ title, meta, defaultOpen = true, children }: Readonly<CollapsibleSectionProps>) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="settings-section">
      <button
        type="button"
        className="settings-section-toggle"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="settings-section-title">{title}</span>
        <span className="settings-section-toggle-right">
          {meta && <span className="settings-section-meta">{meta}</span>}
          <span className="settings-section-chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
        </span>
      </button>
      {isOpen && <div className="settings-section-body">{children}</div>}
    </div>
  );
}

interface DevProviderCardProps {
  providerRef: string;
  provider: ProviderConfig;
  envStatus: Record<string, boolean>;
  onChange: (p: ProviderConfig) => void;
  onSave: () => void;
}

function DevProviderCard({ providerRef, provider, envStatus, onChange, onSave }: Readonly<DevProviderCardProps>) {
  const { mutate: testConn, isPending: testing, data: testResult, reset: resetTest } = useTestProviderConnection();
  const { mutate: refreshModels, isPending: refreshing } = useRefreshDevProviderModels();
  const { mutate: setEnvVar, isPending: savingKey } = useSetEnvVar();
  const isOpenAiCompatible = provider.kind === 'openai-compatible';
  const isGithubCopilot = provider.kind === 'github-copilot';
  const [newModelId, setNewModelId] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const handleTest = () => {
    resetTest();
    testConn(providerRef);
  };

  const handleRefresh = () => refreshModels(providerRef);

  const handleEnvSave = (value: string) => {
    if (provider.apiKeyEnvVar) {
      setEnvVar({ key: provider.apiKeyEnvVar, value }, { onSuccess: onSave });
    }
  };

  const providerModelIds = getProviderModelIds(provider);

  const addProviderModel = () => {
    const modelId = newModelId.trim();
    if (!modelId) return;

    const models = [...getProviderModels(provider)];
    if (!models.some((entry) => entry.name === modelId)) {
      models.push({ name: modelId });
    }

    onChange(setProviderModels(provider, models));
    setNewModelId('');
  };

  const removeProviderModel = (modelId: string) => {
    const models = getProviderModels(provider).filter((entry) => entry.name !== modelId);

    onChange({
      ...setProviderModels(provider, models),
      model: provider.model === modelId ? undefined : provider.model,
      defaultModel: provider.defaultModel === modelId ? undefined : provider.defaultModel,
    });
  };

  const setDefaultContextWindow = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    onChange({ ...provider, contextWindow: Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed });
  };

  const modelDiscovery = provider.modelDiscovery ?? {};

  return (
    <div className="provider-card">
      <div className="provider-card-header">
        <button
          type="button"
          className="provider-card-toggle"
          onClick={() => setIsOpen((open) => !open)}
        >
          <span>
            {providerRef}
            <span className="provider-badge">{provider.kind}</span>
            {provider.isDefault && <span className="provider-badge provider-badge-default">default</span>}
          </span>
          <span className="provider-card-chevron" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
        </button>
        <div className="provider-card-actions">
          <button type="button" className="btn-secondary" onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : '⟳ Refresh models'}
          </button>
          <button type="button" className="btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? 'Testing…' : '⚡ Test connection'}
          </button>
        </div>
      </div>

      {isOpen && testResult && (
        <div className={`test-result test-result-compact ${testResult.ok ? 'test-result--ok' : 'test-result--error'}`}>
          {testResult.ok
            ? `✓ Connected (${testResult.latencyMs}ms)`
            : `✗ ${testResult.error ?? 'Connection failed'}`}
        </div>
      )}

      {isOpen && <div className="provider-card-body">
        {isOpenAiCompatible && (
          <label className="provider-field-row">
            <span>Base URL</span>
            <input
              type="url"
              value={provider.baseUrl ?? ''}
              onChange={(e) => onChange({ ...provider, baseUrl: e.target.value || undefined })}
              placeholder="https://api.openai.com/v1"
            />
          </label>
        )}
        {isOpenAiCompatible && (
          <label className="provider-field-row">
            <span>API key env var</span>
            <input
              type="text"
              value={provider.apiKeyEnvVar ?? ''}
              onChange={(e) => onChange({ ...provider, apiKeyEnvVar: e.target.value || undefined })}
              placeholder="e.g. AI_TEAM_LLM_API_KEY"
            />
          </label>
        )}
        {isOpenAiCompatible && provider.apiKeyEnvVar && (
          <div className="provider-field-row">
            <span>API key value</span>
            <ApiKeyField
              envVarName={provider.apiKeyEnvVar}
              isSet={envStatus[provider.apiKeyEnvVar] ?? false}
              onSave={handleEnvSave}
              saving={savingKey}
            />
          </div>
        )}
        {isGithubCopilot && (
          <div className="provider-field-row">
            <span>Authentication</span>
            <span className="provider-model-list">Uses GitHub OAuth/CLI auth. No API key env var required.</span>
          </div>
        )}
        <div className="provider-field-row provider-field-row-stack">
          <span>Provider models</span>
          <div className="provider-models-panel">
            <p className="settings-help-text provider-model-limits-help">
              Prompt budget is what AI Team can fill per turn for context usage tracking.
            </p>
            {providerModelIds.length > 0 ? (
              <div className="provider-model-contexts">
                {providerModelIds.map((modelId) => (
                  <div key={modelId} className="provider-model-context-row">
                    <div className="provider-model-main">
                      <code>{modelId}</code>
                      {(() => {
                        const model = getProviderModels(provider).find((entry) => entry.name === modelId);
                        if (!model) return null;

                        const effective = formatTokens(model.maxPromptTokens ?? model.contextWindow ?? provider.contextWindow);
                        const total = formatTokens(model.maxContextWindowTokens);
                        const output = formatTokens(model.maxOutputTokens);

                        if (!effective && !total && !output) return null;

                        const parts: string[] = [];
                        if (effective) parts.push(`prompt ${effective}`);
                        if (total) parts.push(`context ${total}`);
                        if (output) parts.push(`output ${output}`);

                        return <span className="provider-model-limits">{parts.join(' · ')}</span>;
                      })()}
                    </div>
                    <span className="provider-model-context-readonly">
                      {formatTokens(getProviderContextWindow(provider, modelId)) ?? '—'}
                    </span>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => removeProviderModel(modelId)}
                      title={`Remove ${modelId}`}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="settings-muted-text">No models added yet.</p>
            )}
            <div className="provider-model-add-row">
              <input
                type="text"
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="e.g. gpt-4.1"
                onKeyDown={(e) => e.key === 'Enter' && addProviderModel()}
              />
              <button type="button" className="btn-secondary" onClick={addProviderModel} disabled={!newModelId.trim()}>
                + Add model
              </button>
            </div>
          </div>
        </div>
        <label className="provider-field-row">
          <span>Default context window</span>
          <input
            type="number"
            value={provider.contextWindow ?? ''}
            onChange={(e) => setDefaultContextWindow(e.target.value)}
            min={1}
            placeholder={String(DEFAULT_CONTEXT_WINDOW)}
          />
        </label>

        <div className="provider-field-row provider-field-row-stack">
          <span>Refresh status</span>
          <div className="provider-refresh-meta">
            <span>Last refresh: {formatDateTime(modelDiscovery.lastRefreshedAt)}</span>
            <span>
              Status: {modelDiscovery.lastRefreshStatus === 'error' ? 'Error' : modelDiscovery.lastRefreshStatus === 'ok' ? 'OK' : 'Unknown'}
            </span>
            {modelDiscovery.lastRefreshError && (
              <span className="provider-refresh-error">Last error: {modelDiscovery.lastRefreshError}</span>
            )}
          </div>
        </div>
      </div>}
    </div>
  );
}

interface DeveloperProvidersSectionProps {
  devDraft: DeveloperConfig;
  envStatus: Record<string, boolean>;
  onChange: (d: DeveloperConfig) => void;
  onRefreshEnv: () => void;
}

function DeveloperProvidersSection({ devDraft, envStatus, onChange, onRefreshEnv }: Readonly<DeveloperProvidersSectionProps>) {
  const [newRef, setNewRef] = useState('');

  const addProvider = () => {
    const ref = newRef.trim();
    if (!ref) return;
    const providers = getDeveloperProviders(devDraft);
    onChange(setDeveloperProviders(devDraft, { ...providers, [ref]: { kind: 'openai-compatible' } }));
    setNewRef('');
  };

  const providers = getDeveloperProviders(devDraft);

  return (
    <CollapsibleSection
      title="My Providers"
      meta="config.developer.json · git-ignored"
    >
        {Object.entries(providers).map(([ref, provider]) => (
          <DevProviderCard
            key={ref}
            providerRef={ref}
            provider={provider}
            envStatus={envStatus}
            onChange={(p) => onChange(setDeveloperProviders(devDraft, { ...providers, [ref]: p }))}
            onSave={onRefreshEnv}
          />
        ))}
        {Object.keys(providers).length === 0 && (
          <p className="settings-muted-text">
            No providers configured. Add one below.
          </p>
        )}
        <div className="tag-add-row tag-add-row-spaced">
          <input
            type="text"
            value={newRef}
            onChange={(e) => setNewRef(e.target.value)}
            placeholder="Provider name (e.g. openai, my-local)"
            onKeyDown={(e) => e.key === 'Enter' && addProvider()}
          />
          <button type="button" className="btn-secondary" onClick={addProvider} disabled={!newRef.trim()}>
            + Add provider
          </button>
        </div>
    </CollapsibleSection>
  );
}

interface UserProfileSectionProps {
  devDraft: DeveloperConfig;
  onChange: (d: DeveloperConfig) => void;
}

function UserProfileSection({ devDraft, onChange }: Readonly<UserProfileSectionProps>) {
  const profile = getDeveloperProfile(devDraft);

  const patch = (key: keyof NonNullable<DeveloperConfig['developer']>, value: string) => {
    onChange(setDeveloperProfile(devDraft, { ...profile, [key]: value || undefined }));
  };

  return (
    <CollapsibleSection
      title="My Profile"
      meta="config.developer.json · git-ignored"
    >
        <div className="user-profile-grid">
          <label className="provider-field-row">
            <span>Name</span>
            <input
              type="text"
              value={profile.name ?? ''}
              onChange={(e) => patch('name', e.target.value)}
              placeholder="Your display name"
            />
          </label>
          <label className="provider-field-row">
            <span>Email</span>
            <input
              type="email"
              value={profile.email ?? ''}
              onChange={(e) => patch('email', e.target.value)}
              placeholder="you@company.com"
            />
          </label>
        </div>
    </CollapsibleSection>
  );
}

interface UserDefaultsSectionProps {
  devDraft: DeveloperConfig;
  onChange: (d: DeveloperConfig) => void;
}

function UserDefaultsSection({ devDraft, onChange }: Readonly<UserDefaultsSectionProps>) {
  const providers = getDeveloperProviders(devDraft);
  const providerRefs = Object.keys(providers);
  const defaultProviderRef = getDefaultProviderRef(devDraft, providers) ?? '';
  const defaultProvider = defaultProviderRef ? providers[defaultProviderRef] : undefined;
  const modelOptions = getProviderModelOptions(defaultProvider);
  const currentModel = defaultProvider?.model
    ?? defaultProvider?.defaultModel
    ?? '';

  return (
    <CollapsibleSection
      title="Defaults"
      meta="config.developer.json · git-ignored"
    >
        <div className="settings-help-text">Set your personal default provider and model used as primary fallback.</div>
        <div className="user-defaults-grid">
          <label className="provider-field-row">
            <span>Default provider</span>
            <select
              value={defaultProviderRef}
              onChange={(e) => onChange(setDeveloperDefaultProvider(devDraft, e.target.value || undefined))}
              aria-label="Default provider"
              title="Select default provider"
            >
              <option value="">(none)</option>
              {providerRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
            </select>
          </label>

          {modelOptions.length > 0 ? (
            <label className="provider-field-row">
              <span>Default model</span>
              <select
                value={currentModel}
                onChange={(e) => {
                  const nextModel = e.target.value || undefined;
                  const withProvider = setDeveloperDefaultProvider(devDraft, defaultProviderRef || undefined);
                  onChange(setDefaultModelForProvider(withProvider, defaultProviderRef || undefined, nextModel));
                }}
                aria-label="Default model"
                title="Select default model"
                disabled={!defaultProviderRef}
              >
                <option value="">(none)</option>
                {modelOptions.map(({ name, modelId }) => (
                  <option key={`${name}:${modelId}`} value={modelId}>{name}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="provider-field-row">
              <span>Default model</span>
              <input
                type="text"
                value={currentModel}
                onChange={(e) => {
                  const nextModel = e.target.value.trim() || undefined;
                  const withProvider = setDeveloperDefaultProvider(devDraft, defaultProviderRef || undefined);
                  onChange(setDefaultModelForProvider(withProvider, defaultProviderRef || undefined, nextModel));
                }}
                placeholder="e.g. gpt-4.1"
                disabled={!defaultProviderRef}
              />
            </label>
          )}
        </div>
    </CollapsibleSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Team Settings — reads/writes config.json
// ─────────────────────────────────────────────────────────────────────────────

interface ModelKeyRow {
  id: string;
  keyName: string;
  provider: string;
  model: string;
  contextWindow: string;
}

let modelKeyRowCounter = 0;

function createModelKeyRowId(): string {
  modelKeyRowCounter += 1;
  return `mk-row-${modelKeyRowCounter}`;
}

function rowsFromModelKeys(modelKeys: Record<string, ModelKeyEntry>): ModelKeyRow[] {
  return Object.entries(modelKeys).map(([keyName, entry]) => ({
    id: createModelKeyRowId(),
    keyName,
    provider: entry.provider,
    model: entry.model,
    contextWindow: String(entry.contextWindow ?? ''),
  }));
}

function rowsToModelKeys(
  rows: ModelKeyRow[],
  providerConfigs: Record<string, ProviderConfig>,
): Record<string, ModelKeyEntry> {
  const result: Record<string, ModelKeyEntry> = {};
  for (const row of rows) {
    if (!row.keyName.trim() || !row.provider.trim() || !row.model.trim()) continue;
    const entry: ModelKeyEntry = { provider: row.provider.trim(), model: row.model.trim() };
    const cw = Number.parseInt(row.contextWindow, 10);
    entry.contextWindow = !Number.isNaN(cw) && cw > 0
      ? cw
      : getProviderContextWindow(providerConfigs[row.provider.trim()], row.model.trim());
    result[row.keyName.trim()] = entry;
  }
  return result;
}

function canonicalModelKeys(modelKeys: Record<string, ModelKeyEntry>): string {
  return JSON.stringify(
    Object.entries(modelKeys)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, value.provider, value.model, value.contextWindow ?? null]),
  );
}

interface ModelKeysSectionProps {
  title?: string;
  meta?: string;
  modelKeys: Record<string, ModelKeyEntry>;
  providerConfigs: Record<string, ProviderConfig>;
  providerRefs: string[];
  providerAvailableModels: Record<string, string[]>;
  usedKeys: Set<string>;
  onChange: (modelKeys: Record<string, ModelKeyEntry>) => void;
}

function ModelKeysSection({
  title = 'Model Keys',
  meta,
  modelKeys,
  providerConfigs,
  providerRefs,
  providerAvailableModels,
  usedKeys,
  onChange,
}: Readonly<ModelKeysSectionProps>) {
  const [rows, setRows] = useState<ModelKeyRow[]>(() => rowsFromModelKeys(modelKeys));

  useEffect(() => {
    const currentProjection = canonicalModelKeys(rowsToModelKeys(rows, providerConfigs));
    const incomingProjection = canonicalModelKeys(modelKeys);
    if (currentProjection !== incomingProjection) {
      setRows(rowsFromModelKeys(modelKeys));
    }
  }, [modelKeys, providerConfigs, rows]);

  const updateRow = (i: number, patch: Partial<ModelKeyRow>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setRows(next);
    onChange(rowsToModelKeys(next, providerConfigs));
  };

  const deleteRow = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    setRows(next);
    onChange(rowsToModelKeys(next, providerConfigs));
  };

  const addRow = () => setRows([...rows, { id: createModelKeyRowId(), keyName: '', provider: '', model: '', contextWindow: '' }]);

  return (
    <CollapsibleSection title={title} meta={meta}>
        <div className="settings-help-text">
          Define named keys like <code>fast</code> or <code>best</code>. Each key maps to a provider and a specific model ID.
        </div>
        <table className="models-table">
          <thead>
            <tr>
              <th>Key name</th>
              <th>Provider</th>
              <th>Model ID</th>
              <th>Context window</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const availableModels = row.provider ? (providerAvailableModels[row.provider] ?? []) : [];
              return (
                <tr key={row.id}>
                  <td>
                    <input
                      type="text"
                      value={row.keyName}
                      onChange={(e) => updateRow(i, { keyName: e.target.value })}
                      placeholder="e.g. fast"
                    />
                    {usedKeys.has(row.keyName) && <span className="in-use-badge" title="Used by an agent">in use</span>}
                  </td>
                  <td>
                    <select
                      value={row.provider}
                      onChange={(e) => updateRow(i, { provider: e.target.value, model: '' })}
                      aria-label="Provider for model key row"
                      title="Select provider"
                    >
                      <option value="">(select provider)</option>
                      {providerRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
                    </select>
                  </td>
                  <td>
                    {availableModels.length > 0 ? (
                      <select
                        value={row.model}
                        onChange={(e) => updateRow(i, { model: e.target.value })}
                        aria-label="Model for model key row"
                        title="Select model"
                      >
                        <option value="">(select model)</option>
                        {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={row.model}
                        onChange={(e) => updateRow(i, { model: e.target.value })}
                        placeholder="e.g. gpt-4o"
                      />
                    )}
                  </td>
                  <td>
                    <input
                      type="number"
                      value={row.contextWindow}
                      onChange={(e) => updateRow(i, { contextWindow: e.target.value })}
                      placeholder="provider default"
                      min={1}
                    />
                  </td>
                  <td>
                    <button type="button" className="btn-icon" onClick={() => deleteRow(i)} title="Remove">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" className="btn-add" onClick={addRow}>+ Add model key</button>
    </CollapsibleSection>
  );
}

interface SystemModelsSectionProps {
  title?: string;
  meta?: string;
  systemModels: Record<string, { provider?: string; modelKey?: string; model?: string; contextWindow?: number }>;
  providerRefs: string[];
  providerAvailableModels: Record<string, string[]>;
  providerConfigs: Record<string, ProviderConfig>;
  onChange: (sm: Record<string, { provider?: string; modelKey?: string; model?: string; contextWindow?: number }>) => void;
}

function SystemModelsSection({
  title = 'System Models',
  meta,
  systemModels,
  providerRefs,
  providerAvailableModels,
  providerConfigs,
  onChange,
}: Readonly<SystemModelsSectionProps>) {
  const allKeys = [
    ...Object.keys(SYSTEM_MODEL_KEY_LABELS),
    ...Object.keys(systemModels).filter((k) => !(k in SYSTEM_MODEL_KEY_LABELS)),
  ];

  const update = (purposeKey: string, patch: Partial<{ provider?: string; modelKey?: string; model?: string; contextWindow?: number }>) => {
    const existing = systemModels[purposeKey] ?? {};
    onChange({ ...systemModels, [purposeKey]: { ...existing, ...patch } });
  };

  return (
    <CollapsibleSection title={title} meta={meta}>
        <div className="settings-help-text">
          Choose direct provider/model assignments for internal operations. Context window falls back to provider defaults.
        </div>
        {allKeys.map((purposeKey) => {
          const entry = systemModels[purposeKey];
          const label = SYSTEM_MODEL_KEY_LABELS[purposeKey] ?? purposeKey;
          const providerRef = entry?.provider ?? '';
          const availableModels = providerRef ? (providerAvailableModels[providerRef] ?? []) : [];
          const fallbackContext = getProviderContextWindow(providerConfigs[providerRef], entry?.model);
          return (
            <div className="system-model-row" key={purposeKey}>
              <span className="system-model-label" title={purposeKey}>{label}</span>
              <select
                value={providerRef}
                onChange={(e) => update(purposeKey, { provider: e.target.value || undefined, model: undefined })}
                aria-label={`Provider for ${label}`}
                title={`Select provider for ${label}`}
              >
                <option value="">(default provider)</option>
                {providerRefs.map((ref) => <option key={ref} value={ref}>{ref}</option>)}
              </select>
              {availableModels.length > 0 ? (
                <select
                  value={entry?.model ?? ''}
                  onChange={(e) => update(purposeKey, {
                    model: e.target.value || undefined,
                    contextWindow: e.target.value
                      ? getProviderContextWindow(providerConfigs[providerRef], e.target.value)
                      : undefined,
                  })}
                  aria-label={`Model for ${label}`}
                  title={`Select model for ${label}`}
                >
                  <option value="">(default model)</option>
                  {availableModels.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input
                  type="text"
                  value={entry?.model ?? ''}
                  onChange={(e) => update(purposeKey, { model: e.target.value || undefined })}
                  placeholder="e.g. gpt-4.1"
                />
              )}
              <input
                type="number"
                min={1}
                value={entry?.contextWindow ?? ''}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  update(purposeKey, { contextWindow: Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed });
                }}
                placeholder={String(fallbackContext)}
                aria-label={`Context window for ${label}`}
                title={`Context window for ${label}`}
              />
            </div>
          );
        })}
    </CollapsibleSection>
  );
}

interface TagListSectionProps {
  title: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}

function TagListSection({ title, items, placeholder, onChange }: Readonly<TagListSectionProps>) {
  const [newValue, setNewValue] = useState('');

  const add = () => {
    const v = newValue.trim();
    if (v && !items.includes(v)) {
      onChange([...items, v]);
      setNewValue('');
    }
  };

  const remove = (item: string) => onChange(items.filter((i) => i !== item));

  return (
    <CollapsibleSection title={title}>
        <div className="tags-list">
          {items.map((item) => (
            <span key={item} className="tag-item">
              {item}
              <button type="button" className="tag-remove" onClick={() => remove(item)} title="Remove">✕</button>
            </span>
          ))}
        </div>
        <div className="tag-add-row">
          <input
            type="text"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder={placeholder}
            onKeyDown={(e) => e.key === 'Enter' && add()}
          />
          <button type="button" className="btn-secondary" onClick={add}>Add</button>
        </div>
    </CollapsibleSection>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

type SettingsTab = 'user' | 'team';

export function SettingsPage() {
  const { data: config, isLoading: configLoading, error: configError } = useConfig();
  const { data: devConfig, isLoading: devLoading } = useDeveloperConfig();
  const { data: envStatus = {} } = useEnvStatus();
  const { data: agentModelKeys } = useAgentModelKeys();
  const { mutate: saveConfig, isPending: savingConfig } = useSaveConfig();
  const { mutate: saveDevConfig, isPending: savingDev } = useSaveDeveloperConfig();

  const [activeTab, setActiveTab] = useState<SettingsTab>('user');
  const [teamDraft, setTeamDraft] = useState<TeamConfig | null>(null);
  const [devDraft, setDevDraft] = useState<DeveloperConfig | null>(null);
  const [teamDirty, setTeamDirty] = useState(false);
  const [devDirty, setDevDirty] = useState(false);

  useEffect(() => {
    if (config && !teamDirty) setTeamDraft(config);
  }, [config, teamDirty]);

  useEffect(() => {
    if (devConfig && !devDirty) setDevDraft(devConfig);
  }, [devConfig, devDirty]);

  if (configLoading || devLoading) return <div className="settings-loading">Loading settings…</div>;
  if (configError) return <div className="settings-error">Failed to load settings: {(configError as Error).message}</div>;
  if (!teamDraft || !devDraft) return null;

  const patchTeam = (updater: (d: TeamConfig) => TeamConfig) => {
    setTeamDraft((d) => updater(d!));
    setTeamDirty(true);
  };

  const patchDev = (updater: DeveloperConfig) => {
    setDevDraft(updater);
    setDevDirty(true);
  };

  const handleSave = () => {
    if (activeTab === 'team' && teamDirty) {
      saveConfig(teamDraft, { onSuccess: () => setTeamDirty(false) });
    } else if (activeTab === 'user' && devDirty) {
      saveDevConfig(devDraft, { onSuccess: () => setDevDirty(false) });
    }
  };

  const handleReset = () => {
    if (activeTab === 'team' && config) { setTeamDraft(config); setTeamDirty(false); }
    if (activeTab === 'user' && devConfig) { setDevDraft(devConfig); setDevDirty(false); }
  };

  const isDirty = activeTab === 'team' ? teamDirty : devDirty;
  const isSaving = activeTab === 'team' ? savingConfig : savingDev;

  // Build merged provider refs for model key dropdowns
  const teamProviders = teamDraft.providers ?? {};
  const devProviders = getDeveloperProviders(devDraft);
  const allProviderRefs = [...new Set([...Object.keys(teamProviders), ...Object.keys(devProviders)])];
  const providerAvailableModels: Record<string, string[]> = {};
  for (const [ref, p] of Object.entries(devProviders)) {
    const ids = getProviderModelIds(p);
    if (ids.length) providerAvailableModels[ref] = ids;
  }

  const userModelKeys = getDeveloperModelKeys(devDraft);
  const usedKeys = new Set(agentModelKeys?.usedKeys ?? []);

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        <div className="settings-actions">
          <button type="button" className="btn-secondary" onClick={handleReset} disabled={!isDirty}>
            Reset
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={!isDirty || isSaving}>
            {isSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="settings-tabs">
        <button
          type="button"
          className={`settings-tab ${activeTab === 'user' ? 'settings-tab--active' : ''}`}
          onClick={() => setActiveTab('user')}
        >
          User
          {devDirty && <span className="settings-tab-dirty">•</span>}
        </button>
        <button
          type="button"
          className={`settings-tab ${activeTab === 'team' ? 'settings-tab--active' : ''}`}
          onClick={() => setActiveTab('team')}
        >
          Team
          {teamDirty && <span className="settings-tab-dirty">•</span>}
        </button>
      </div>

      {activeTab === 'user' && (
        <>
          <UserDefaultsSection
            devDraft={devDraft}
            onChange={patchDev}
          />

          <UserProfileSection
            devDraft={devDraft}
            onChange={patchDev}
          />

          <DeveloperProvidersSection
            devDraft={devDraft}
            envStatus={envStatus}
            onChange={patchDev}
            onRefreshEnv={() => {}}
          />

          <ModelKeysSection
            title="My Model Keys"
            meta="config.developer.json · git-ignored"
            modelKeys={userModelKeys}
            providerConfigs={devProviders}
            providerRefs={allProviderRefs}
            providerAvailableModels={providerAvailableModels}
            usedKeys={usedKeys}
            onChange={(mk) => patchDev(setDeveloperModelKeys(devDraft, mk))}
          />

          <SystemModelsSection
            title="System Models"
            meta="config.developer.json · git-ignored"
            systemModels={getDeveloperSystemModels(devDraft)}
            providerRefs={allProviderRefs}
            providerAvailableModels={providerAvailableModels}
            providerConfigs={devProviders}
            onChange={(sm) => patchDev(setDeveloperSystemModels(devDraft, sm))}
          />
        </>
      )}

      {activeTab === 'team' && (
        <>
          <TagListSection
            title="Allowed CLI Tools"
            items={teamDraft.allowedCliTools ?? []}
            placeholder="e.g. git, npm, pnpm"
            onChange={(tools) => patchTeam((d) => ({ ...d, allowedCliTools: tools }))}
          />

          <TagListSection
            title="Skill Sources"
            items={teamDraft.skillSources ?? []}
            placeholder="https://..."
            onChange={(sources) => patchTeam((d) => ({ ...d, skillSources: sources }))}
          />
        </>
      )}
    </div>
  );
}


