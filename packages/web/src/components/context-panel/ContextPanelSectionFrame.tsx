import type { ReactNode } from 'react';
import type { ContextSection } from './contextPanelTypes';

interface SectionFrameProps {
  section: ContextSection;
  expandedSection: ContextSection | null;
  title: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
  keepMounted?: boolean;
  onToggleSection: (section: ContextSection) => void;
  children: ReactNode;
}

export function ContextPanelSectionFrame({ section, expandedSection, title, count, action, keepMounted, onToggleSection, children }: Readonly<SectionFrameProps>) {
  const isExpanded = expandedSection === section;

  let content: ReactNode;
  if (keepMounted) {
    content = <div className={`context-section-content${isExpanded ? '' : ' context-section-content-hidden'}`}>{children}</div>;
  } else if (isExpanded) {
    content = <div className="context-section-content">{children}</div>;
  } else {
    content = null;
  }

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

      {content}
    </div>
  );
}
