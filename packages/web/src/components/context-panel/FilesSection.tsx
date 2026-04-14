import { useState } from 'react';
import { FileTree, type FileTreeCounts } from '../FileTree';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';
import '../ContextPanel.css';

interface FilesSectionProps {
  agentId: string;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
}

export function FilesSection({
  agentId,
  expandedSection,
  onToggleSection,
}: Readonly<FilesSectionProps>) {
  const [counts, setCounts] = useState<FileTreeCounts | null>(null);

  const countBadge =
    counts === null ? undefined : (
      <span className="files-section-counts">
        <span className="files-section-count-list">{counts.listCount}</span>
        <span className="files-section-count-read">{counts.readCount}</span>
        <span className="files-section-count-write">{counts.writeCount}</span>
      </span>
    );

  return (
    <ContextPanelSectionFrame
      section="files"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={
        <span>
          <i className="codicon codicon-folder" /> Accessible Files
        </span>
      }
      count={countBadge}
      keepMounted
    >
      <div className="context-section-filetree">
        <FileTree agentId={agentId} editMode={false} onCountsChange={setCounts} />
      </div>
    </ContextPanelSectionFrame>
  );
}
