import { useState } from 'react';
import { FileTree } from '../FileTree';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioFileAccessSectionProps {
  agentId: string;
  forceEditMode?: boolean;
  highlightedPaths?: ReadonlySet<string>;
}

export function PortfolioFileAccessSection({ agentId, forceEditMode = false, highlightedPaths }: Readonly<PortfolioFileAccessSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const effectiveEditMode = forceEditMode || isEditing;

  return (
    <PortfolioSectionCard
      title="File Access"
      icon="📂"
      isEditing={effectiveEditMode}
      onEdit={() => setIsEditing(true)}
      saveLabel={forceEditMode ? undefined : 'Done'}
      onSave={forceEditMode ? undefined : () => setIsEditing(false)}
    >
      <FileTree agentId={agentId} editMode={effectiveEditMode} highlightedPaths={highlightedPaths} />
    </PortfolioSectionCard>
  );
}
