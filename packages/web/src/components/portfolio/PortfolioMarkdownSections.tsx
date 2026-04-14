import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AiTeamHttpClient } from '@ai-team/api-client';
import type { MarkdownSection } from '@ai-team/core';
import { MarkdownEditor, PortfolioSectionCard } from './portfolioShared';

// Standard sections displayed as dedicated cards, in preferred order.
const STANDARD_ORDER = [
  'Scope of Responsibility',
  'Introduction',
  'Working Rules',
  'Successful Outcome',
];

// Always rendered even when not yet authored — shows empty state with edit prompt.
const ALWAYS_SHOWN = new Set(['Working Rules', 'Successful Outcome']);

// Sections moved to YAML or removed — never rendered as markdown cards.
const EXCLUDED_SECTIONS = new Set([
  'Read These Files First',
  'Routing Defaults',
  'Do Not Use This Agent For',
  'Personality Profile',
  'Handoffs', // auto-generated for Copilot context; managed via YAML handoffs editor
]);

const SECTION_ICONS: Record<string, string> = {
  'Scope of Responsibility': '🎯',
  Introduction: '👋',
  'Working Rules': '📐',
  'Successful Outcome': '✅',
};

const SKILLS_LINE_RE = /^\*\*Skills:\*\*.*$/gm;

/** Strip the auto-managed `**Skills:** ...` line from display / editing */
function stripSkillsLine(content: string): string {
  return content
    .replaceAll(SKILLS_LINE_RE, '')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trimEnd();
}

interface SectionCardProps {
  heading: string;
  content: string;
  /** Skill IDs to re-inject as the Skills line on save (Scope of Responsibility only) */
  specializations?: string[];
  onSave: (heading: string, content: string) => Promise<void>;
}

function SectionCard({ heading, content, specializations, onSave }: Readonly<SectionCardProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isScopeSection = heading === 'Scope of Responsibility';
  const displayContent = isScopeSection ? stripSkillsLine(content) : content;

  const startEdit = () => {
    setDraft(displayContent);
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
      let finalContent = draft;
      if (isScopeSection && specializations && specializations.length > 0) {
        finalContent = `${draft.trimEnd()}\n\n**Skills:** ${specializations.join(' · ')}`;
      }
      await onSave(heading, finalContent);
      setIsEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const icon = SECTION_ICONS[heading] ?? '📄';
  const shownContent = isEditing ? draft : displayContent;

  let sectionContent: ReactNode;
  if (isEditing) {
    sectionContent = <MarkdownEditor value={draft} onChange={setDraft} />;
  } else if (shownContent) {
    sectionContent = (
      <div className="portfolio-bio">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{shownContent}</ReactMarkdown>
      </div>
    );
  } else {
    sectionContent = <p className="text-muted">Empty — click edit to add content.</p>;
  }

  return (
    <PortfolioSectionCard
      title={heading}
      icon={icon}
      onEdit={startEdit}
      isEditing={isEditing}
      saving={saving}
      onSave={save}
      onCancel={cancel}
    >
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {sectionContent}
      {isScopeSection && !isEditing && specializations && specializations.length > 0 ? (
        <div className="skill-tags-group portfolio-scope-skill-tags">
          {specializations.map((s) => (
            <span key={s} className="skill-tag">
              {s}
            </span>
          ))}
        </div>
      ) : null}
    </PortfolioSectionCard>
  );
}

interface PortfolioMarkdownSectionsProps {
  agentId: string;
  specializations: string[];
  client: AiTeamHttpClient;
  onUpdated: () => void;
  onlyHeadings?: string[];
  excludeHeadings?: string[];
  /** Show an "Add section" button for creating optional custom sections. */
  showAddSection?: boolean;
}

export function PortfolioMarkdownSections({
  agentId,
  specializations,
  client,
  onUpdated,
  onlyHeadings,
  excludeHeadings,
  showAddSection,
}: Readonly<PortfolioMarkdownSectionsProps>) {
  const [sections, setSections] = useState<MarkdownSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addingSection, setAddingSection] = useState(false);
  const [newHeading, setNewHeading] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);

  const loadSections = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const fetched = await client.agents.getSections(agentId);
      setSections(fetched.filter((s) => s.heading !== ''));
    } catch (e: any) {
      setLoadError(e?.message || 'Failed to load sections');
    } finally {
      setLoading(false);
    }
  }, [agentId, client]);

  useEffect(() => {
    void loadSections();
  }, [loadSections]);

  const handleSave = async (heading: string, content: string) => {
    await client.agents.updateSection(agentId, heading, { content });
    await loadSections();
    onUpdated();
  };

  const handleAddSection = async () => {
    const heading = newHeading.trim();
    if (!heading) return;
    await handleSave(heading, '');
    setNewHeading('');
    setAddingSection(false);
  };

  const handleAddKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleAddSection();
    }
    if (e.key === 'Escape') {
      setAddingSection(false);
      setNewHeading('');
    }
  };

  const openAddForm = () => {
    setAddingSection(true);
    setTimeout(() => addInputRef.current?.focus(), 0);
  };

  if (loading) return <p className="text-muted portfolio-sections-status">Loading sections…</p>;
  if (loadError)
    return <p className="portfolio-section-error portfolio-sections-status">{loadError}</p>;

  // Order: standard sections first (in preferred order), then any extras; exclude moved/removed sections.
  const sectionMap = new Map(sections.map((s) => [s.heading, s.content]));
  const ordered: Array<{ heading: string; content: string }> = [];
  const onlySet = onlyHeadings && onlyHeadings.length > 0 ? new Set(onlyHeadings) : null;
  const excludeSet = new Set(excludeHeadings ?? []);

  const shouldInclude = (heading: string): boolean => {
    if (EXCLUDED_SECTIONS.has(heading)) return false;
    if (excludeSet.has(heading)) return false;
    if (onlySet && !onlySet.has(heading)) return false;
    return true;
  };

  for (const h of STANDARD_ORDER) {
    // ALWAYS_SHOWN sections render even without existing content (shows empty-state + edit prompt).
    if ((sectionMap.has(h) || ALWAYS_SHOWN.has(h)) && shouldInclude(h)) {
      ordered.push({ heading: h, content: sectionMap.get(h) ?? '' });
    }
  }
  for (const s of sections) {
    if (!STANDARD_ORDER.includes(s.heading) && shouldInclude(s.heading)) {
      ordered.push(s);
    }
  }

  if (ordered.length === 0 && !showAddSection) return null;

  return (
    <>
      {ordered.map(({ heading, content }) => (
        <SectionCard
          key={heading}
          heading={heading}
          content={content}
          specializations={heading === 'Scope of Responsibility' ? specializations : undefined}
          onSave={handleSave}
        />
      ))}
      {showAddSection && (
        <div className="portfolio-add-section-row">
          {addingSection ? (
            <div className="portfolio-add-section-form">
              <input
                ref={addInputRef}
                className="portfolio-add-section-input"
                placeholder="Section heading…"
                value={newHeading}
                onChange={(e) => setNewHeading(e.target.value)}
                onKeyDown={handleAddKeyDown}
              />
              <button
                className="btn-save"
                onClick={() => void handleAddSection()}
                disabled={!newHeading.trim()}
              >
                Add
              </button>
              <button
                className="btn-header-action"
                onClick={() => {
                  setAddingSection(false);
                  setNewHeading('');
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button className="btn-add-handoff" onClick={openAddForm}>
              <i className="codicon codicon-add" /> Add section
            </button>
          )}
        </div>
      )}
    </>
  );
}
