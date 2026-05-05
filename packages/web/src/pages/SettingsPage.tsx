import { useState, useEffect, useRef, type ReactNode } from 'react';
import {
  useConfig,
  useSaveConfig,
  useAgentModelKeys,
  useUserConfig,
  useSaveUserConfig,
  useTestProviderConnection,
  useEnvStatus,
  useSetEnvVar,
  useRefreshDevProviderModels,
} from '../hooks/useConfig';
import type { TeamConfig, UserConfig, ProviderConfig, ModelKeyEntry } from '../hooks/useConfig';
import { SYSTEM_MODEL_KEY_LABELS } from './settingsConstants';
import './SettingsPage.css';

const DEFAULT_CONTEXT_WINDOW = 128_000;

// ─────────────────────────────────────────────────────────────────────────────
// User Settings — reads/writes config.user.json + .ai-team/.env
// ─────────────────────────────────────────────────────────────────────────────

function getUserProviders(config: UserConfig): Record<string, ProviderConfig> {
  return config.providers ?? {};
}

function getUserProfile(config: UserConfig): NonNullable<UserConfig['developer']> {
  return {
    id: config.developer?.id,
    name: config.developer?.name,
    email: config.developer?.email,
    avatar: config.developer?.avatar,
    portfolioUrl: config.developer?.portfolioUrl,
  };
}

function getUserModelKeys(config: UserConfig): Record<string, ModelKeyEntry> {
  return config.modelKeys ?? {};
}

function getUserSystemModels(
  config: UserConfig
): Record<
  string,
  { provider?: string; modelKey?: string; model?: string; contextWindow?: number }
> {
  return config.systemModels ?? {};
}

function setUserProviders(
  config: UserConfig,
  providers: Record<string, ProviderConfig>
): UserConfig {
  return {
    ...config,
    providers,
  };
}

function setUserProfile(
  config: UserConfig,
  profile: NonNullable<UserConfig['developer']>
): UserConfig {
  return {
    ...config,
    developer: profile,
  };
}

function setUserModelKeys(
  config: UserConfig,
  modelKeys: Record<string, ModelKeyEntry>
): UserConfig {
  return {
    ...config,
    modelKeys,
  };
}

function setUserSystemModels(
  config: UserConfig,
  systemModels: Record<
    string,
    { provider?: string; modelKey?: string; model?: string; contextWindow?: number }
  >
): UserConfig {
  return {
    ...config,
    systemModels,
  };
}

function setUserDefaultProvider(
  config: UserConfig,
  providerRef?: string,
  modelId?: string,
  contextWindow?: number
): UserConfig {
  return {
    ...config,
    defaultModel: providerRef
      ? { provider: providerRef, model: modelId ?? '', ...(contextWindow ? { contextWindow } : {}) }
      : undefined,
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
  }>
): ProviderConfig {
  return {
    ...provider,
    models,
  };
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
  config: UserConfig,
  providerRef: string | undefined,
  modelId: string | undefined
): UserConfig {
  if (!providerRef || !modelId) {
    return config;
  }

  const providers = getUserProviders(config);
  const provider = providers[providerRef];
  if (!provider) {
    return config;
  }

  const models = [...getProviderModels(provider)];
  const exists = models.some((entry) => entry.name === modelId);
  if (!exists) {
    models.push({ name: modelId });
  }

  return setUserProviders(config, {
    ...providers,
    [providerRef]: {
      ...setProviderModels(provider, models),
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
    const explicit =
      model?.contextWindow ?? model?.maxPromptTokens ?? model?.maxContextWindowTokens;
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
      <span
        className={`api-key-status ${isSet ? 'api-key-status--set' : 'api-key-status--missing'}`}
      >
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
          <button
            type="button"
            className="btn-primary btn-sm"
            onClick={handleSave}
            disabled={saving || !value.trim()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {editing && (
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                setEditing(false);
                setValue('');
              }}
            >
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

function CollapsibleSection({
  title,
  meta,
  defaultOpen = true,
  children,
}: Readonly<CollapsibleSectionProps>) {
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
          <span className="settings-section-chevron" aria-hidden="true">
            {isOpen ? '▾' : '▸'}
          </span>
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
  allowProviderEdit?: boolean;
}

function DevProviderCard({
  providerRef,
  provider,
  envStatus,
  onChange,
  onSave,
  allowProviderEdit = true,
}: Readonly<DevProviderCardProps>) {
  const {
    mutate: testConn,
    isPending: testing,
    data: testResult,
    reset: resetTest,
  } = useTestProviderConnection();
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
      defaultModel: provider.defaultModel === modelId ? undefined : provider.defaultModel,
    });
  };

  const setDefaultContextWindow = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    onChange({
      ...provider,
      contextWindow: Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed,
    });
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
          </span>
          <span className="provider-card-chevron" aria-hidden="true">
            {isOpen ? '▾' : '▸'}
          </span>
        </button>
        <div className="provider-card-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={handleRefresh}
            disabled={refreshing || !allowProviderEdit}
            title={allowProviderEdit ? 'Refresh provider models' : 'Team provider is read-only here'}
          >
            {refreshing ? 'Refreshing…' : '⟳ Refresh models'}
          </button>
          <button type="button" className="btn-secondary" onClick={handleTest} disabled={testing}>
            {testing ? 'Testing…' : '⚡ Test connection'}
          </button>
        </div>
      </div>

      {testResult && (
        <div
          className={`test-result test-result-compact ${testResult.ok ? 'test-result--ok' : 'test-result--error'}`}
        >
          <span>
            {testResult.ok
              ? `✓ Connected (${testResult.latencyMs}ms)`
              : `✗ ${testResult.error ?? 'Connection failed'}`}
          </span>
          <button
            type="button"
            className="test-result-remove"
            onClick={resetTest}
            aria-label="Remove test result message"
            title="Remove message"
          >
            ✕
          </button>
        </div>
      )}

      {isOpen && (
        <div className="provider-card-body">
          {!allowProviderEdit && (
            <p className="settings-help-text">
              This provider is managed in <code>.ai-team/config.json</code>. You can still set its
              API key value below.
            </p>
          )}

          {isOpenAiCompatible && (
            <label className="provider-field-row">
              <span>Base URL</span>
              <input
                type="url"
                value={provider.baseUrl ?? ''}
                onChange={(e) => onChange({ ...provider, baseUrl: e.target.value || undefined })}
                placeholder="https://api.openai.com/v1"
                disabled={!allowProviderEdit}
              />
            </label>
          )}
          {isOpenAiCompatible && (
            <label className="provider-field-row">
              <span>API key env var</span>
              <input
                type="text"
                value={provider.apiKeyEnvVar ?? ''}
                onChange={(e) =>
                  onChange({ ...provider, apiKeyEnvVar: e.target.value || undefined })
                }
                placeholder="e.g. AI_TEAM_LLM_API_KEY"
                disabled={!allowProviderEdit}
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
              <span className="provider-model-list">
                Uses GitHub OAuth/CLI auth. No API key env var required.
              </span>
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
                          const model = getProviderModels(provider).find(
                            (entry) => entry.name === modelId
                          );
                          if (!model) return null;

                          const effective = formatTokens(
                            model.maxPromptTokens ?? model.contextWindow ?? provider.contextWindow
                          );
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
                  disabled={!allowProviderEdit}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={addProviderModel}
                  disabled={!newModelId.trim() || !allowProviderEdit}
                >
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
              disabled={!allowProviderEdit}
            />
          </label>

          <div className="provider-field-row provider-field-row-stack">
            <span>Refresh status</span>
            <div className="provider-refresh-meta">
              <span>Last refresh: {formatDateTime(modelDiscovery.lastRefreshedAt)}</span>
              <span>
                Status:{' '}
                {modelDiscovery.lastRefreshStatus === 'error'
                  ? 'Error'
                  : modelDiscovery.lastRefreshStatus === 'ok'
                    ? 'OK'
                    : 'Unknown'}
              </span>
              {modelDiscovery.lastRefreshError && (
                <span className="provider-refresh-error">
                  Last error: {modelDiscovery.lastRefreshError}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface UserProvidersSectionProps {
  devDraft: UserConfig;
  teamProviders: Record<string, ProviderConfig>;
  envStatus: Record<string, boolean>;
  onChange: (d: UserConfig) => void;
  onRefreshEnv: () => void;
}

function UserProvidersSection({
  devDraft,
  teamProviders,
  envStatus,
  onChange,
  onRefreshEnv,
}: Readonly<UserProvidersSectionProps>) {
  const [newRef, setNewRef] = useState('');

  const addProvider = () => {
    const ref = newRef.trim();
    if (!ref) return;
    const providers = getUserProviders(devDraft);
    onChange(setUserProviders(devDraft, { ...providers, [ref]: { kind: 'openai-compatible' } }));
    setNewRef('');
  };

  const providers = getUserProviders(devDraft);
  const mergedProviders: Record<string, ProviderConfig> = {
    ...teamProviders,
    ...providers,
  };

  return (
    <CollapsibleSection title="My Providers" meta="config.user.json · git-ignored">
      {Object.entries(mergedProviders).map(([ref, provider]) => {
        const isUserProvider = Boolean(providers[ref]);
        return (
        <DevProviderCard
          key={ref}
          providerRef={ref}
          provider={provider}
          envStatus={envStatus}
          allowProviderEdit={isUserProvider}
          onChange={(p) => {
            if (!isUserProvider) return;
            onChange(setUserProviders(devDraft, { ...providers, [ref]: p }));
          }}
          onSave={onRefreshEnv}
        />
        );
      })}
      {Object.keys(mergedProviders).length === 0 && (
        <p className="settings-muted-text">No providers configured. Add one below.</p>
      )}
      <div className="tag-add-row tag-add-row-spaced">
        <input
          type="text"
          value={newRef}
          onChange={(e) => setNewRef(e.target.value)}
          placeholder="Provider name (e.g. openai, my-local)"
          onKeyDown={(e) => e.key === 'Enter' && addProvider()}
        />
        <button
          type="button"
          className="btn-secondary"
          onClick={addProvider}
          disabled={!newRef.trim()}
        >
          + Add provider
        </button>
      </div>
    </CollapsibleSection>
  );
}

interface UserProfileSectionProps {
  devDraft: UserConfig;
  onChange: (d: UserConfig) => void;
}

function UserProfileSection({ devDraft, onChange }: Readonly<UserProfileSectionProps>) {
  const profile = getUserProfile(devDraft);

  const patch = (key: keyof NonNullable<UserConfig['developer']>, value: string) => {
    onChange(setUserProfile(devDraft, { ...profile, [key]: value || undefined }));
  };

  return (
    <CollapsibleSection title="My Profile" meta="config.user.json · git-ignored">
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

interface UnifiedModelSectionProps {
  devDraft: UserConfig;
  providerRefs: string[];
  providerAvailableModels: Record<string, string[]>;
  providerConfigs: Record<string, ProviderConfig>;
  usedKeys: Set<string>;
  onChange: (d: UserConfig) => void;
}

function UnifiedModelSection({
  devDraft,
  providerRefs,
  providerAvailableModels,
  providerConfigs,
  usedKeys,
  onChange,
}: Readonly<UnifiedModelSectionProps>) {
  const systemModelKeys = [
    ...Object.keys(SYSTEM_MODEL_KEY_LABELS),
    ...Object.keys(devDraft.systemModels ?? {}).filter((k) => !(k in SYSTEM_MODEL_KEY_LABELS)),
  ];

  const [rows, setRows] = useState<ModelKeyRow[]>(() =>
    rowsFromModelKeys(getUserModelKeys(devDraft))
  );

  useEffect(() => {
    const incomingModelKeys = getUserModelKeys(devDraft);
    const currentProjection = canonicalModelKeys(rowsToModelKeys(rows, providerConfigs));
    const incomingProjection = canonicalModelKeys(incomingModelKeys);
    if (currentProjection !== incomingProjection) {
      setRows(rowsFromModelKeys(incomingModelKeys));
    }
  }, [devDraft, providerConfigs, rows]);

  const storedDefaultProvider = devDraft.defaultModel?.provider;
  const defaultProviderRef =
    storedDefaultProvider && providerRefs.includes(storedDefaultProvider)
      ? storedDefaultProvider
      : '';
  const defaultProviderConfig = defaultProviderRef
    ? providerConfigs[defaultProviderRef]
    : undefined;
  const defaultModelList = defaultProviderRef
    ? (providerAvailableModels[defaultProviderRef] ?? [])
    : [];
  const currentDefaultModel =
    devDraft.defaultModel?.model ?? defaultProviderConfig?.defaultModel ?? '';
  const defaultContextWindow = devDraft.defaultModel?.contextWindow;
  const defaultFallbackContext = getProviderContextWindow(
    defaultProviderConfig,
    currentDefaultModel
  );

  const updateDefaultProvider = (providerRef: string) => {
    onChange(setUserDefaultProvider(devDraft, providerRef || undefined, undefined, undefined));
  };

  const updateDefaultModel = (modelId: string) => {
    const withDefault = setUserDefaultProvider(
      devDraft,
      defaultProviderRef || undefined,
      modelId || undefined,
      defaultContextWindow
    );
    onChange(
      setDefaultModelForProvider(withDefault, defaultProviderRef || undefined, modelId || undefined)
    );
  };

  const updateDefaultContextWindow = (value: string) => {
    const parsed = Number.parseInt(value, 10);
    const cw = Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed;
    onChange(
      setUserDefaultProvider(
        devDraft,
        defaultProviderRef || undefined,
        currentDefaultModel || undefined,
        cw
      )
    );
  };

  const systemModels = getUserSystemModels(devDraft);

  const updateSystemModel = (
    purposeKey: string,
    patch: Partial<{ provider?: string; model?: string; contextWindow?: number }>
  ) => {
    const existing = systemModels[purposeKey] ?? {};
    onChange(
      setUserSystemModels(devDraft, { ...systemModels, [purposeKey]: { ...existing, ...patch } })
    );
  };

  const updateRow = (i: number, patch: Partial<ModelKeyRow>) => {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    setRows(next);
    onChange(setUserModelKeys(devDraft, rowsToModelKeys(next, providerConfigs)));
  };

  const deleteRow = (i: number) => {
    const next = rows.filter((_, idx) => idx !== i);
    setRows(next);
    onChange(setUserModelKeys(devDraft, rowsToModelKeys(next, providerConfigs)));
  };

  const addRow = () =>
    setRows([
      ...rows,
      { id: createModelKeyRowId(), keyName: '', provider: '', model: '', contextWindow: '' },
    ]);

  return (
    <CollapsibleSection title="Models" meta="config.user.json · git-ignored">
      <table className="models-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Provider</th>
            <th>Model</th>
            <th>Context window</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <span className="fixed-key" title="Default model key">
                default
              </span>
            </td>
            <td>
              <select
                value={defaultProviderRef}
                onChange={(e) => updateDefaultProvider(e.target.value)}
                aria-label="Provider for default model"
                title="Select default provider"
              >
                <option value="">(none)</option>
                {providerRefs.map((ref) => (
                  <option key={ref} value={ref}>
                    {ref}
                  </option>
                ))}
              </select>
            </td>
            <td>
              {defaultModelList.length > 0 ? (
                <select
                  value={currentDefaultModel}
                  onChange={(e) => updateDefaultModel(e.target.value)}
                  disabled={!defaultProviderRef}
                  aria-label="Default model"
                  title="Select default model"
                >
                  <option value="">(none)</option>
                  {defaultModelList.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={currentDefaultModel}
                  onChange={(e) => updateDefaultModel(e.target.value)}
                  disabled={!defaultProviderRef}
                  placeholder="e.g. gpt-4.1"
                />
              )}
            </td>
            <td>
              <input
                type="number"
                min={1}
                value={defaultContextWindow ?? ''}
                onChange={(e) => updateDefaultContextWindow(e.target.value)}
                placeholder={String(defaultFallbackContext)}
                aria-label="Context window for default model"
                title="Context window for default model"
              />
            </td>
            <td />
          </tr>
          {systemModelKeys.map((purposeKey) => {
            const entry = systemModels[purposeKey];
            const label = SYSTEM_MODEL_KEY_LABELS[purposeKey] ?? purposeKey;
            const providerRef = entry?.provider ?? '';
            const availableModels = providerRef ? (providerAvailableModels[providerRef] ?? []) : [];
            const fallbackContext = getProviderContextWindow(
              providerConfigs[providerRef],
              entry?.model
            );
            return (
              <tr key={purposeKey}>
                <td>
                  <span className="fixed-key" title={purposeKey}>
                    {label}
                  </span>
                </td>
                <td>
                  <select
                    value={providerRef}
                    onChange={(e) =>
                      updateSystemModel(purposeKey, {
                        provider: e.target.value || undefined,
                        model: undefined,
                      })
                    }
                    aria-label={`Provider for ${label}`}
                    title={`Select provider for ${label}`}
                  >
                    <option value="">(default provider)</option>
                    {providerRefs.map((ref) => (
                      <option key={ref} value={ref}>
                        {ref}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {availableModels.length > 0 ? (
                    <select
                      value={entry?.model ?? ''}
                      onChange={(e) =>
                        updateSystemModel(purposeKey, {
                          model: e.target.value || undefined,
                          contextWindow: e.target.value
                            ? getProviderContextWindow(providerConfigs[providerRef], e.target.value)
                            : undefined,
                        })
                      }
                      aria-label={`Model for ${label}`}
                      title={`Select model for ${label}`}
                    >
                      <option value="">(default model)</option>
                      {availableModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={entry?.model ?? ''}
                      onChange={(e) =>
                        updateSystemModel(purposeKey, { model: e.target.value || undefined })
                      }
                      placeholder="e.g. gpt-4.1"
                    />
                  )}
                </td>
                <td>
                  <input
                    type="number"
                    min={1}
                    value={entry?.contextWindow ?? ''}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      updateSystemModel(purposeKey, {
                        contextWindow: Number.isNaN(parsed) || parsed <= 0 ? undefined : parsed,
                      });
                    }}
                    placeholder={String(fallbackContext)}
                    aria-label={`Context window for ${label}`}
                    title={`Context window for ${label}`}
                  />
                </td>
                <td />
              </tr>
            );
          })}
          {rows.map((row, i) => {
            const availableModels = row.provider
              ? (providerAvailableModels[row.provider] ?? [])
              : [];
            return (
              <tr key={row.id}>
                <td>
                  <input
                    type="text"
                    value={row.keyName}
                    onChange={(e) => updateRow(i, { keyName: e.target.value })}
                    placeholder="e.g. fast"
                  />
                  {usedKeys.has(row.keyName) && (
                    <span className="in-use-badge" title="Used by an agent">
                      in use
                    </span>
                  )}
                </td>
                <td>
                  <select
                    value={row.provider}
                    onChange={(e) => updateRow(i, { provider: e.target.value, model: '' })}
                    aria-label="Provider for model key row"
                    title="Select provider"
                  >
                    <option value="">(select provider)</option>
                    {providerRefs.map((ref) => (
                      <option key={ref} value={ref}>
                        {ref}
                      </option>
                    ))}
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
                      {availableModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
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
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => deleteRow(i)}
                    title="Remove"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" className="btn-add" onClick={addRow}>
        + Add model key
      </button>
    </CollapsibleSection>
  );
}

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
  providerConfigs: Record<string, ProviderConfig>
): Record<string, ModelKeyEntry> {
  const result: Record<string, ModelKeyEntry> = {};
  for (const row of rows) {
    if (!row.keyName.trim() || !row.provider.trim() || !row.model.trim()) continue;
    const entry: ModelKeyEntry = { provider: row.provider.trim(), model: row.model.trim() };
    const cw = Number.parseInt(row.contextWindow, 10);
    entry.contextWindow =
      !Number.isNaN(cw) && cw > 0
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
      .map(([key, value]) => [key, value.provider, value.model, value.contextWindow ?? null])
  );
}

interface TagListSectionProps {
  title: string;
  items: string[];
  placeholder: string;
  onChange: (items: string[]) => void;
}

interface FileTypeGroupEditorSectionProps {
  groups: Record<string, { label?: string; patterns?: string[]; extensions?: string[] }>;
  onChange: (
    groups: Record<string, { label?: string; patterns?: string[]; extensions?: string[] }>
  ) => void;
}

const DEFAULT_FILE_TYPE_GROUPS: Record<string, { label: string; patterns: string[] }> = {
  code: {
    label: 'Code',
    patterns: [
      '*.ts',
      '*.tsx',
      '*.js',
      '*.jsx',
      '*.mjs',
      '*.cjs',
      '*.py',
      '*.go',
      '*.rs',
      '*.java',
      '*.cs',
      '*.cpp',
      '*.c',
      '*.h',
      '*.hpp',
      '*.rb',
      '*.php',
      '*.swift',
      '*.kt',
      '*.sql',
      '*.sh',
      '*.ps1',
      '*.html',
      '*.css',
      '*.scss',
      '*.sass',
      '*.less',
      '*.vue',
      '*.svelte',
    ],
  },
  documentation: {
    label: 'Documentation',
    patterns: ['*.md', '*.mdx', '*.txt', '*.rst', '*.adoc'],
  },
  configuration: {
    label: 'Configuration',
    patterns: [
      '*.json',
      '*.jsonc',
      '*.yaml',
      '*.yml',
      '*.toml',
      '*.ini',
      '*.env',
      '*.conf',
      '*.config',
      '*.properties',
      '*.lock',
    ],
  },
  tests: { label: 'Tests', patterns: ['*.test.*', '*.spec.*', '**/__tests__/**', '*.snap'] },
  binaries: {
    label: 'Binaries',
    patterns: [
      '*.png',
      '*.jpg',
      '*.jpeg',
      '*.gif',
      '*.webp',
      '*.ico',
      '*.bmp',
      '*.svg',
      '*.pdf',
      '*.zip',
      '*.gz',
      '*.tar',
      '*.7z',
      '*.jar',
      '*.db',
      '*.sqlite',
      '*.sqlite3',
      '*.woff',
      '*.woff2',
      '*.ttf',
      '*.otf',
      '*.eot',
      '*.mp3',
      '*.mp4',
      '*.mov',
      '*.avi',
      '*.wav',
      '*.exe',
      '*.dll',
      '*.so',
      '*.dylib',
    ],
  },
  assets: {
    label: 'Assets',
    patterns: [
      '*.png',
      '*.jpg',
      '*.jpeg',
      '*.gif',
      '*.webp',
      '*.ico',
      '*.bmp',
      '*.svg',
      '*.mp3',
      '*.mp4',
      '*.mov',
      '*.avi',
      '*.wav',
    ],
  },
  other: { label: 'Other', patterns: [] },
};

function parsePatternsInput(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter((part) => part.length > 0)
    ),
  ];
}

function FileTypeGroupEditorSection({
  groups,
  onChange,
}: Readonly<FileTypeGroupEditorSectionProps>) {
  const mergedGroups = Object.fromEntries(
    [...new Set([...Object.keys(DEFAULT_FILE_TYPE_GROUPS), ...Object.keys(groups)])].map((id) => {
      const defaults = DEFAULT_FILE_TYPE_GROUPS[id];
      const configured = groups[id];
      const configuredPatterns =
        configured?.patterns && configured.patterns.length > 0
          ? configured.patterns
          : (configured?.extensions ?? []);
      return [
        id,
        {
          label: configured?.label ?? defaults?.label ?? id,
          patterns: configuredPatterns.length > 0 ? configuredPatterns : (defaults?.patterns ?? []),
        },
      ];
    })
  ) as Record<string, { label?: string; patterns?: string[]; extensions?: string[] }>;
  const missingDefaultIds = Object.keys(DEFAULT_FILE_TYPE_GROUPS).filter((id) => !(id in groups));
  const [groupId, setGroupId] = useState('');
  const [groupLabel, setGroupLabel] = useState('');
  const [groupExtensions, setGroupExtensions] = useState('');

  const addGroup = () => {
    const id = groupId.trim();
    if (!id || mergedGroups[id]) {
      return;
    }
    onChange({
      ...groups,
      [id]: {
        label: groupLabel.trim() || id,
        patterns: parsePatternsInput(groupExtensions),
      },
    });
    setGroupId('');
    setGroupLabel('');
    setGroupExtensions('');
  };

  const removeGroup = (id: string) => {
    if (id in DEFAULT_FILE_TYPE_GROUPS) {
      return;
    }
    const next = { ...groups };
    delete next[id];
    onChange(next);
  };

  const updateGroup = (id: string, patch: Partial<{ label?: string; patterns?: string[] }>) => {
    const baseline = mergedGroups[id] ?? { label: id, patterns: [] };
    onChange({
      ...groups,
      [id]: {
        ...baseline,
        ...groups[id],
        ...patch,
      },
    });
  };

  const applyMissingDefaults = () => {
    const next = { ...groups };
    for (const id of missingDefaultIds) {
      next[id] = {
        label: DEFAULT_FILE_TYPE_GROUPS[id]!.label,
        patterns: [...DEFAULT_FILE_TYPE_GROUPS[id]!.patterns],
      };
    }
    onChange(next);
  };

  return (
    <CollapsibleSection
      title="File Type Groups"
      meta={`${Object.keys(mergedGroups).length} groups`}
    >
      <p className="settings-help-text">
        Configure reusable file-type groups with glob patterns (for example: `*.md`, `*.test.*`,
        `**/docs/**`, `*.agent.md`). “All files” is always available automatically.
      </p>
      {missingDefaultIds.length > 0 ? (
        <div className="settings-filetype-defaults-hint">
          <span>Missing recommended defaults: {missingDefaultIds.join(', ')}</span>
          <button type="button" className="btn-secondary" onClick={applyMissingDefaults}>
            Apply missing defaults
          </button>
        </div>
      ) : null}
      <div className="settings-filetype-list">
        {Object.entries(mergedGroups).map(([id, group]) => {
          const groupValue = group as {
            label?: string;
            patterns?: string[];
            extensions?: string[];
          };
          return (
            <div key={id} className="settings-filetype-group">
              <div className="settings-filetype-group-header">
                <strong>{id}</strong>
                {id in DEFAULT_FILE_TYPE_GROUPS ? (
                  <span className="settings-section-meta">default (not removable)</span>
                ) : (
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => removeGroup(id)}
                    title="Remove group"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="tag-add-row">
                <input
                  type="text"
                  value={groupValue.label ?? ''}
                  onChange={(event) => updateGroup(id, { label: event.target.value })}
                  placeholder="Display label"
                />
              </div>
              <div className="tag-add-row settings-filetype-extensions-row">
                <input
                  type="text"
                  value={(groupValue.patterns ?? groupValue.extensions ?? []).join(', ')}
                  onChange={(event) =>
                    updateGroup(id, { patterns: parsePatternsInput(event.target.value) })
                  }
                  placeholder="*.ts, *.test.*, **/docs/**, *.agent.md"
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="settings-filetype-new-group">
        <h4>Add group</h4>
        <div className="tag-add-row">
          <input
            type="text"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            placeholder="Group id (e.g. binaries)"
          />
          <input
            type="text"
            value={groupLabel}
            onChange={(event) => setGroupLabel(event.target.value)}
            placeholder="Label (optional)"
          />
          <input
            type="text"
            value={groupExtensions}
            onChange={(event) => setGroupExtensions(event.target.value)}
            placeholder="Initial globs (comma separated)"
            className="settings-filetype-extensions-input"
          />
          <button type="button" className="btn-secondary" onClick={addGroup}>
            Add group
          </button>
        </div>
      </div>
    </CollapsibleSection>
  );
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
            <button
              type="button"
              className="tag-remove"
              onClick={() => remove(item)}
              title="Remove"
            >
              ✕
            </button>
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
        <button type="button" className="btn-secondary" onClick={add}>
          Add
        </button>
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
  const { data: devConfig, isLoading: devLoading } = useUserConfig();
  const { data: envStatus = {} } = useEnvStatus();
  const { data: agentModelKeys } = useAgentModelKeys();
  const { mutate: saveConfig, isPending: savingConfig } = useSaveConfig();
  const { mutate: saveDevConfig, isPending: savingDev } = useSaveUserConfig();

  const [activeTab, setActiveTab] = useState<SettingsTab>('user');
  const [teamDraft, setTeamDraft] = useState<TeamConfig | null>(null);
  const [devDraft, setDevDraft] = useState<UserConfig | null>(null);
  const [teamDirty, setTeamDirty] = useState(false);
  const [devDirty, setDevDirty] = useState(false);

  useEffect(() => {
    if (config && !teamDirty) setTeamDraft(config);
  }, [config, teamDirty]);

  useEffect(() => {
    if (devConfig && !devDirty) setDevDraft(devConfig);
  }, [devConfig, devDirty]);

  const saveDevConfigRef = useRef(saveDevConfig);
  saveDevConfigRef.current = saveDevConfig;
  const saveConfigRef = useRef(saveConfig);
  saveConfigRef.current = saveConfig;

  useEffect(() => {
    if (!devDirty || !devDraft) return;
    const timer = setTimeout(() => {
      saveDevConfigRef.current(devDraft, { onSuccess: () => setDevDirty(false) });
    }, 400);
    return () => clearTimeout(timer);
  }, [devDraft, devDirty]);

  useEffect(() => {
    if (!teamDirty || !teamDraft) return;
    const timer = setTimeout(() => {
      saveConfigRef.current(teamDraft, { onSuccess: () => setTeamDirty(false) });
    }, 400);
    return () => clearTimeout(timer);
  }, [teamDraft, teamDirty]);

  if (configLoading || devLoading) return <div className="settings-loading">Loading settings…</div>;
  if (configError)
    return (
      <div className="settings-error">
        Failed to load settings: {(configError as Error).message}
      </div>
    );
  if (!teamDraft || !devDraft) return null;

  const patchTeam = (updater: (d: TeamConfig) => TeamConfig) => {
    setTeamDraft((d) => updater(d!));
    setTeamDirty(true);
  };

  const patchDev = (updater: UserConfig) => {
    setDevDraft(updater);
    setDevDirty(true);
  };

  // Build merged provider refs for model key dropdowns
  const teamProviders: Record<string, ProviderConfig> = teamDraft.providers ?? {};
  const devProviders = getUserProviders(devDraft);
  const allProviderRefs = [
    ...new Set([...Object.keys(teamProviders), ...Object.keys(devProviders)]),
  ];
  const providerAvailableModels: Record<string, string[]> = {};
  for (const [ref, p] of Object.entries(devProviders)) {
    const ids = getProviderModelIds(p);
    if (ids.length) providerAvailableModels[ref] = ids;
  }

  const usedKeys = new Set(agentModelKeys?.usedKeys ?? []);

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>Settings</h1>
        {(savingDev || savingConfig) && <span className="settings-saving-indicator">Saving…</span>}
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
          <UserProfileSection devDraft={devDraft} onChange={patchDev} />

          <UserProvidersSection
            devDraft={devDraft}
            teamProviders={teamProviders}
            envStatus={envStatus}
            onChange={patchDev}
            onRefreshEnv={() => {}}
          />

          <UnifiedModelSection
            devDraft={devDraft}
            providerRefs={allProviderRefs}
            providerAvailableModels={providerAvailableModels}
            providerConfigs={devProviders}
            usedKeys={usedKeys}
            onChange={patchDev}
          />
        </>
      )}

      {activeTab === 'team' && (
        <>
          <CollapsibleSection title="Project" meta="config.json">
            <div className="user-profile-grid">
              <label className="provider-field-row">
                <span>Project Name</span>
                <input
                  type="text"
                  value={teamDraft.projectName ?? ''}
                  onChange={(e) =>
                    patchTeam((d) => ({ ...d, projectName: e.target.value || undefined }))
                  }
                  placeholder="e.g. Acme Platform"
                />
              </label>
            </div>
          </CollapsibleSection>

          <FileTypeGroupEditorSection
            groups={teamDraft.fileTypeGroups ?? {}}
            onChange={(fileTypeGroups) => patchTeam((d) => ({ ...d, fileTypeGroups }))}
          />
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
