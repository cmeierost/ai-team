import { FileTree } from '../FileTree';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';

interface FilesSectionProps {
  agentId: string;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
}

export function FilesSection({ agentId, expandedSection, onToggleSection }: Readonly<FilesSectionProps>) {
  return (
    <ContextPanelSectionFrame
      section="files"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<span><i className="codicon codicon-folder" /> Accessible Files</span>}
    >
      <div className="context-section-filetree">
        <FileTree agentId={agentId} editMode={false} />
      </div>
    </ContextPanelSectionFrame>
  );
}
