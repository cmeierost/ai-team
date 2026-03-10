import type { ReactNode } from 'react';
import type { ContextSection } from './contextPanelTypes';

interface SectionFrameProps {
  section: ContextSection;
  expandedSection: ContextSection | null;
  title: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
  onToggleSection: (section: ContextSection) => void;
  children: ReactNode;
}

export function ContextPanelSectionFrame({ section, expandedSection, title, count, action, onToggleSection, children }: Readonly<SectionFrameProps>) {
  const isExpanded = expandedSection === section;

  return (
    <div className="context-section">
      <div className="context-section-header-wrapper">
        <button
          className={`context-section-header ${isExpanded ? 'expanded' : ''}`}
          onClick={() => onToggleSection(section)}
        >
          <i className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`} />
          <span className="context-section-title">{title}</span>
          {count === undefined ? null : <span className="context-section-count">{count}</span>}
        </button>
        {action}
      </div>

      {isExpanded ? <div className="context-section-content">{children}</div> : null}
    </div>
  );
}
