import { type KeyboardEvent, type ReactNode, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AgentSkill } from '../../types';
import '../Portfolio.css';

/** Strip the leading ![avatar](...) line that agent .md files use as an image hack */
export function stripAvatarLine(markdown: string | undefined): string {
  if (!markdown) return '';
  return markdown.replace(/^!\[avatar\]\([^)]+\)\s*\n?/m, '').trimStart();
}

export const TYPE_LABELS: Record<string, string> = {
  executive: 'Executive',
  leadership: 'Leadership',
  'team-lead': 'Team Lead',
  'individual-contributor': 'Individual Contributor',
  'quality-gate': 'Quality Gate',
  'cross-concern': 'Cross-Concern',
  product: 'Product',
};

export const CONTEXT_LABELS: Record<string, string> = {
  task: 'Task',
  module: 'Module',
  feature: 'Feature',
  repository: 'Repository',
  organization: 'Organization',
};

export const STYLE_ICONS: Record<string, string> = {
  collaborative: '🤝',
  analytical: '📊',
  direct: '🎯',
  supportive: '🌿',
  strategic: '🚀',
};

export const LEVEL_CHIP: Record<string, string> = {
  executive: 'chip-executive',
  senior: 'chip-senior',
  'mid-level': 'chip-mid',
  junior: 'chip-junior',
};

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

export function TagInput({ tags, onChange, placeholder = 'Add…' }: Readonly<TagInputProps>) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const val = input.trim();
    if (val && !tags.includes(val)) onChange([...tags, val]);
    setInput('');
  };

  const handleKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addTag();
    }
    if (event.key === 'Backspace' && !input && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="tag-input-container">
      {tags.map((tag) => (
        <span key={tag} className="tag-input-chip">
          {tag}
          <button
            type="button"
            className="tag-input-remove"
            onClick={() => onChange(tags.filter((item) => item !== tag))}
            aria-label={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={handleKey}
        onBlur={addTag}
        placeholder={placeholder}
      />
    </div>
  );
}

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
}

export function MarkdownEditor({ value, onChange }: Readonly<MarkdownEditorProps>) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');

  return (
    <div className="md-editor">
      <div className="md-editor-tabs">
        <button type="button" className={`md-tab ${tab === 'write' ? 'md-tab-active' : ''}`} onClick={() => setTab('write')}>
          Write
        </button>
        <button type="button" className={`md-tab ${tab === 'preview' ? 'md-tab-active' : ''}`} onClick={() => setTab('preview')}>
          Preview
        </button>
      </div>
      {tab === 'write' ? (
        <textarea
          className="md-editor-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Write agent bio in Markdown…"
          spellCheck
        />
      ) : (
        <div className="md-editor-preview">
          {value ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown> : <p className="text-muted">Nothing to preview.</p>}
        </div>
      )}
    </div>
  );
}

interface SkillEditorProps {
  skills: AgentSkill[];
  onChange: (skills: AgentSkill[]) => void;
}

export function SkillEditor({ skills, onChange }: Readonly<SkillEditorProps>) {
  const addSkill = () => {
    const id = `skill-${Date.now()}`;
    onChange([...skills, { id, name: '' }]);
  };

  const removeSkill = (index: number) => onChange(skills.filter((_, itemIndex) => itemIndex !== index));
  const patchSkill = (index: number, patch: Partial<AgentSkill>) =>
    onChange(skills.map((skill, itemIndex) => (itemIndex === index ? { ...skill, ...patch } : skill)));

  return (
    <div className="skill-editor">
      {skills.map((skill, index) => (
        <div key={skill.id} className="skill-editor-item">
          <div className="skill-editor-row">
            <input
              className="skill-editor-name"
              placeholder="Skill name"
              value={skill.name}
              onChange={(event) => patchSkill(index, { name: event.target.value })}
            />
            <button
              type="button"
              className="skill-editor-remove"
              onClick={() => removeSkill(index)}
              aria-label="Remove skill"
            >
              ×
            </button>
          </div>
          <textarea
            className="skill-editor-desc"
            placeholder="Description (optional)"
            value={skill.description ?? ''}
            rows={2}
            onChange={(event) => patchSkill(index, { description: event.target.value || undefined })}
          />
          <div className="skill-editor-label">Tags</div>
          <TagInput tags={skill.tags ?? []} onChange={(tags) => patchSkill(index, { tags })} placeholder="Add tag…" />
        </div>
      ))}
      <button type="button" className="skill-editor-add" onClick={addSkill}>
        + Add skill
      </button>
    </div>
  );
}

interface PortfolioSectionCardProps {
  title: string;
  icon?: string;
  children: ReactNode;
}

export function PortfolioSectionCard({ title, icon, children }: Readonly<PortfolioSectionCardProps>) {
  return (
    <section className="portfolio-card">
      <h3 className="portfolio-card-title">
        {icon ? <span className="portfolio-card-icon">{icon}</span> : null}
        {title}
      </h3>
      {children}
    </section>
  );
}
