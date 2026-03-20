import { useState, type ReactNode } from 'react';
import type { AgentLlm } from '../../types';
import { PortfolioSectionCard } from './portfolioShared';
import { useConfig } from '../../hooks/useConfig';
import type { LlmProviderConfig, TeamConfig } from '../../hooks/useConfig';

const TEMPERATURE_LABELS: Array<[number, string]> = [
  [0, 'Deterministic (0)'],
  [0.2, 'Focused (0.2)'],
  [0.5, 'Balanced (0.5)'],
  [0.7, 'Creative (0.7)'],
  [1, 'Expressive (1.0)'],
  [1.5, 'Wild (1.5)'],
  [2, 'Maximum (2.0)'],
];

function temperatureLabel(value: number): string {
  const closest = TEMPERATURE_LABELS.reduce(
    (a, b) => (Math.abs(b[0] - value) < Math.abs(a[0] - value) ? b : a),
    TEMPERATURE_LABELS[0],
  );
  return closest[1].split(' ')[0];
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface LlmEditFormProps {
  draft: AgentLlm;
  onChange: React.Dispatch<React.SetStateAction<AgentLlm>>;
}

function findDefaultProviderKey(config: TeamConfig | undefined): string | undefined {
  const providers = config?.providers ?? {};
  return config?.defaultLlmProvider
    ?? Object.keys(providers).find((k) => providers[k].isDefault)
    ?? Object.keys(providers)[0];
}

function resolveModelKeyTarget(
  modelKey: string | undefined,
  config: TeamConfig | undefined,
): { provider?: string; model?: string } {
  if (!modelKey) {
    return {};
  }

  const named = config?.modelKeys?.[modelKey];
  if (named) {
    return {
      provider: named.provider,
      model: named.model,
    };
  }

  return {};
}

function LlmEditForm({ draft, onChange }: Readonly<LlmEditFormProps>) {
  const { data: config } = useConfig();
  const globalModelKeys = config?.modelKeys ?? {};
  const modelKeyEntries = Object.entries(globalModelKeys).sort(([a], [b]) => a.localeCompare(b));

  const resolvedTarget = resolveModelKeyTarget(draft.modelKey, config);
  const resolvedProvider = resolvedTarget.provider;
  const resolvedModelId = resolvedTarget.model;

  const temperature = draft.params?.temperature;
  const tempDisplay =
    temperature === undefined ? 'default' : `${temperature} · ${temperatureLabel(temperature)}`;
  let modelKeyHint = 'Using default-model';
  if (draft.modelKey) {
    if (resolvedProvider && resolvedModelId) {
      modelKeyHint = `→ ${resolvedProvider} / ${resolvedModelId}`;
    } else {
      modelKeyHint = 'Unknown key — define it in modelKeys first.';
    }
  }

  return (
    <div className="portfolio-form-stack">
      <div className="portfolio-form-grid">
        <label>
          <span>Model key</span>
          <select
            value={draft.modelKey ?? ''}
            onChange={(e) => {
              const nextKey = e.target.value || undefined;
              onChange((d) => ({
                ...d,
                modelKey: nextKey,
                provider: undefined,
                model: undefined,
              }));
            }}
            disabled={modelKeyEntries.length === 0}
          >
            <option value="">(default-model)</option>
            {modelKeyEntries.map(([keyName]) => (
              <option key={keyName} value={keyName}>{keyName}</option>
            ))}
          </select>
          <span className="llm-form-hint">{modelKeyHint}</span>
        </label>
      </div>
      <label>
        <span className="llm-temp-label">Temperature — {tempDisplay}</span>
        <input
          type="range"
          className="llm-temperature-slider"
          min={0}
          max={2}
          step={0.05}
          value={temperature ?? 0.7}
          onChange={(e) =>
            onChange((d) => ({
              ...d,
              params: { ...d.params, temperature: Number.parseFloat(e.target.value) },
            }))
          }
        />
        <div className="llm-temp-scale">
          <span>0 deterministic</span>
          <span>1.0 creative</span>
          <span>2.0 wild</span>
        </div>
        {temperature === undefined ? null : (
          <button
            type="button"
            className="btn-section-cancel"
            onClick={() => onChange((d) => ({ ...d, params: { ...d.params, temperature: undefined } }))}
          >
            Reset to default
          </button>
        )}
      </label>
    </div>
  );
}

function DefaultLlmView({ providers, config }: Readonly<{ providers: Record<string, LlmProviderConfig>; config: TeamConfig | undefined }>) {
  const defaultProviderKey = findDefaultProviderKey(config);
  const defaultProvider = defaultProviderKey ? providers[defaultProviderKey] : undefined;
  const defaultModel = defaultProvider?.model ?? defaultProvider?.defaultModel;
  const defaultContextWindow = defaultProvider?.contextWindow;
  const hasDefault = Boolean(defaultProviderKey ?? defaultModel);

  return (
    <div className="llm-view llm-view-default">
      <span className="llm-default-badge">default-model</span>
      <div className="llm-row">
        {defaultProviderKey ? (
          <span className="llm-item">
            <span className="llm-label">Provider</span>
            {defaultProviderKey}
          </span>
        ) : null}
        {defaultModel ? (
          <span className="llm-item">
            <span className="llm-label">Model</span>
            {defaultModel}
          </span>
        ) : null}
        {defaultContextWindow === undefined ? null : (
          <span className="llm-item">
            <span className="llm-label">Context</span>
            {defaultContextWindow.toLocaleString()} tokens
          </span>
        )}
        {hasDefault ? null : <span className="text-muted">No default configured</span>}
      </div>
    </div>
  );
}

function getDisplayProviderRef(
  llm: AgentLlm,
  providers: Record<string, LlmProviderConfig>,
  modelKeys: NonNullable<TeamConfig['modelKeys']>,
): string | undefined {
  const mappedEntry = llm.modelKey ? modelKeys[llm.modelKey] : undefined;
  if (mappedEntry?.provider) {
    return mappedEntry.provider;
  }
  if (llm.provider) {
    return llm.provider;
  }

  const defaultProviderKey = findDefaultProviderKey({ providers, modelKeys } as TeamConfig);
  if (llm.modelKey && defaultProviderKey && providers[defaultProviderKey]?.models?.some((m) => m.name === llm.modelKey)) {
    return defaultProviderKey;
  }

  return undefined;
}

function getDisplayResolvedModelId(
  llm: AgentLlm,
  selectedProvider: LlmProviderConfig | undefined,
  mappedModel: string | undefined,
): string {
  if (mappedModel) {
    return mappedModel;
  }
  if (llm.modelKey) {
    return selectedProvider?.models?.find((m) => m.name === llm.modelKey)?.name ?? '';
  }
  return llm.model ?? '';
}

function ExplicitLlmView({
  llm,
  providers,
  modelKeys,
}: Readonly<{
  llm: AgentLlm;
  providers: Record<string, LlmProviderConfig>;
  modelKeys: NonNullable<TeamConfig['modelKeys']>;
}>) {
  const temperature = llm.params?.temperature;
  const mappedEntry = llm.modelKey ? modelKeys[llm.modelKey] : undefined;
  const providerRef = getDisplayProviderRef(llm, providers, modelKeys);
  const selectedProvider = providerRef ? providers[providerRef] : undefined;
  const resolvedModelId = getDisplayResolvedModelId(llm, selectedProvider, mappedEntry?.model);
  const contextWindow = llm.modelKey
    ? (selectedProvider?.models?.find((m) => m.name === (mappedEntry?.model ?? llm.modelKey))?.contextWindow ?? selectedProvider?.contextWindow)
    : selectedProvider?.contextWindow;

  let modelItem: ReactNode = null;
  if (llm.modelKey) {
    modelItem = (
      <span className="llm-item">
        <span className="llm-label">Key</span>
        {llm.modelKey}
        {resolvedModelId ? <span className="llm-model-resolved">→ {providerRef ? `${providerRef} / ` : ''}{resolvedModelId}</span> : null}
      </span>
    );
  } else if (llm.model) {
    modelItem = (
      <span className="llm-item">
        <span className="llm-label">Model</span>
        {llm.model}
      </span>
    );
  }

  return (
    <div className="llm-view">
      <div className="llm-row">
        {providerRef ? (
          <span className="llm-item">
            <span className="llm-label">Provider</span>
            {providerRef}
          </span>
        ) : null}
        {modelItem}
        {contextWindow === undefined ? null : (
          <span className="llm-item">
            <span className="llm-label">Context</span>
            {contextWindow.toLocaleString()} tokens
          </span>
        )}
        {temperature === undefined ? null : (
          <span className="llm-item">
            <span className="llm-label">Temp</span>
            {temperature} · {temperatureLabel(temperature)}
          </span>
        )}
      </div>
    </div>
  );
}

function LlmView({ llm }: Readonly<{ llm: AgentLlm }>) {
  const { data: config } = useConfig();
  const temperature = llm.params?.temperature;
  const hasData = Boolean(llm.provider || llm.model || llm.modelKey || temperature !== undefined);
  const providers = config?.providers ?? {};
  const modelKeys = config?.modelKeys ?? {};

  if (!hasData) {
    return <DefaultLlmView providers={providers} config={config} />;
  }
  return <ExplicitLlmView llm={llm} providers={providers} modelKeys={modelKeys} />;
}

// ── Main component ────────────────────────────────────────────────────────────

interface PortfolioLlmSectionProps {
  llm?: AgentLlm;
  onSave: (llm: AgentLlm) => Promise<void>;
}

export function PortfolioLlmSection({ llm, onSave }: Readonly<PortfolioLlmSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<AgentLlm>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => {
    setDraft({ ...llm });
    setSaveError(null);
    setIsEditing(true);
  };

  const cancel = () => {
    setIsEditing(false);
    setSaveError(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const hasParams = draft.params?.temperature !== undefined;
      const clean: AgentLlm = {
        ...(draft.modelKey ? { modelKey: draft.modelKey } : {}),
        ...(hasParams ? { params: { ...draft.params } } : {}),
      };
      await onSave(clean);
      setIsEditing(false);
    } catch (e: unknown) {
      setSaveError((e as Error)?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortfolioSectionCard
      title="LLM"
      icon="🤖"
      onEdit={startEdit}
      isEditing={isEditing}
      saving={saving}
      onSave={save}
      onCancel={cancel}
    >
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {isEditing ? (
        <LlmEditForm draft={draft} onChange={setDraft} />
      ) : (
        <LlmView llm={llm ?? {}} />
      )}
    </PortfolioSectionCard>
  );
}
