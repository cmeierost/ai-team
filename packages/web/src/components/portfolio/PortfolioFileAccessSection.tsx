import { useState } from 'react';
import { FileTree } from '../FileTree';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioFileAccessSectionProps {
  agentId: string;
}

export function PortfolioFileAccessSection({ agentId }: Readonly<PortfolioFileAccessSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <PortfolioSectionCard
      title="File Access"
      icon="📂"
      isEditing={isEditing}
      onEdit={() => setIsEditing(true)}
      saveLabel="Done"
      onSave={() => setIsEditing(false)}
    >
      <FileTree agentId={agentId} editMode={isEditing} />
    </PortfolioSectionCard>
  );
}
