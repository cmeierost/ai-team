import { useCallback, useMemo, useState } from 'react';
import type { Agent } from '../../types';
import {
  CONTEXT_LABELS,
  MarkdownEditor,
  PortfolioSectionCard,
  TYPE_LABELS,
} from './portfolioShared';
import { useSpeechSynthesis } from '../../hooks/useSpeechSynthesis';

const VOICE_PREVIEW_TEXT = 'Hi, I am your AI team assistant. How can I help you today?';

interface IdentityFields {
  type?: Agent['type'];
  contextLevel?: Agent['contextLevel'];
  pronouns?: string;
  ttsVoice?: string;
  ttsRate?: number;
  description?: string;
}

interface PortfolioIdentitySectionProps {
  type?: Agent['type'];
  contextLevel?: Agent['contextLevel'];
  pronouns?: string;
  ttsVoice?: string;
  ttsRate?: number;
  description?: string;
  onSave: (fields: IdentityFields) => Promise<void>;
}

export function PortfolioIdentitySection({
  type,
  contextLevel,
  pronouns,
  ttsVoice,
  ttsRate,
  description,
  onSave,
}: Readonly<PortfolioIdentitySectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<IdentityFields>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { voices, supported: ttsSupported, speakChunk, cancel: cancelTts } = useSpeechSynthesis();
  const selectableVoices = useMemo(() => {
    const englishVoices = voices.filter((voice) => voice.lang?.toLowerCase().startsWith('en'));
    return englishVoices.length > 0 ? englishVoices : voices;
  }, [voices]);

  const previewVoice = useCallback(
    (voiceName: string | undefined, rate: number | undefined) => {
      const voice = voiceName ? selectableVoices.find((v) => v.name === voiceName) : undefined;
      cancelTts();
      speakChunk(VOICE_PREVIEW_TEXT, voice, rate ?? 1);
    },
    [selectableVoices, speakChunk, cancelTts]
  );

  const startEdit = () => {
    setDraft({ type, contextLevel, pronouns, ttsVoice, ttsRate, description });
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
      await onSave(draft);
      setIsEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const v = isEditing ? draft : { type, contextLevel, pronouns, ttsVoice, ttsRate, description };

  return (
    <PortfolioSectionCard
      title="Identity"
      icon="🪪"
      onEdit={startEdit}
      isEditing={isEditing}
      saving={saving}
      onSave={save}
      onCancel={cancel}
    >
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {isEditing ? (
        <div className="portfolio-form-stack">
          <div className="personality-narrative-editor">
            <span className="personality-narrative-label">Description</span>
            <MarkdownEditor
              value={v.description ?? ''}
              onChange={(val) => setDraft((d) => ({ ...d, description: val || undefined }))}
            />
          </div>
          <div className="portfolio-form-grid">
            <label>
              <span>Type</span>
              <select
                value={v.type ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, type: (e.target.value as Agent['type']) || undefined }))
                }
              >
                <option value="">— none —</option>
                {Object.entries(TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Context Level</span>
              <select
                value={v.contextLevel ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    contextLevel: (e.target.value as Agent['contextLevel']) || undefined,
                  }))
                }
              >
                <option value="">— none —</option>
                {Object.entries(CONTEXT_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Pronouns</span>
              <input
                value={v.pronouns ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, pronouns: e.target.value || undefined }))}
                placeholder="they/them"
              />
            </label>
            {ttsSupported ? (
              <label>
                <span>TTS Voice</span>
                <div className="tts-voice-row">
                  <select
                    value={v.ttsVoice ?? ''}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, ttsVoice: e.target.value || undefined }))
                    }
                  >
                    <option value="">— browser default —</option>
                    {selectableVoices.map((voice) => (
                      <option key={voice.name} value={voice.name}>
                        {voice.name}
                        {voice.lang ? ` (${voice.lang})` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="tts-preview-btn"
                    title="Preview this voice"
                    onClick={() => previewVoice(v.ttsVoice, v.ttsRate)}
                  >
                    ▶
                  </button>
                </div>
              </label>
            ) : null}
            {ttsSupported ? (
              <label>
                <span>TTS Speed</span>
                <select
                  value={v.ttsRate ?? 1}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      ttsRate: e.target.value ? parseFloat(e.target.value) : undefined,
                    }))
                  }
                >
                  <option value="">— use my setting —</option>
                  <option value={0.75}>0.75×</option>
                  <option value={1.0}>1×</option>
                  <option value={1.25}>1.25×</option>
                  <option value={1.5}>1.5×</option>
                  <option value={2.0}>2×</option>
                </select>
              </label>
            ) : null}
          </div>
        </div>
      ) : (
        <>
          {v.description ? <p className="portfolio-description">{v.description}</p> : null}
          <div className="identity-chips">
            {v.type ? (
              <span className="portfolio-chip chip-type">{TYPE_LABELS[v.type] ?? v.type}</span>
            ) : null}
            {v.contextLevel ? (
              <span className="portfolio-chip chip-context">
                {CONTEXT_LABELS[v.contextLevel] ?? v.contextLevel}
              </span>
            ) : null}
            {v.pronouns ? <span className="portfolio-chip">{v.pronouns}</span> : null}
            {ttsSupported ? (
              <span className="portfolio-chip" title="TTS voice">
                🔊 {v.ttsVoice ?? 'browser default'}
              </span>
            ) : null}
            {ttsSupported && v.ttsRate ? (
              <span className="portfolio-chip" title="TTS speed">
                {v.ttsRate}×
              </span>
            ) : null}
            {!v.description && !v.type && !v.contextLevel && !v.pronouns && !ttsSupported ? (
              <p className="text-muted">No identity details set.</p>
            ) : null}
          </div>
        </>
      )}
    </PortfolioSectionCard>
  );
}
