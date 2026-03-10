import type { Artifact } from '../../types';
import { formatDate } from '../../utils/contextPanel';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';

function isInContext(artifacts: string[], artifactId: string) {
  return artifacts.includes(artifactId);
}

interface ArtifactsSectionProps {
  artifacts: string[];
  allArtifacts: Artifact[];
  loadingArtifacts: boolean;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onToggleArtifact: (artifactId: string) => void;
}

export function ArtifactsSection({ artifacts, allArtifacts, loadingArtifacts, expandedSection, onToggleSection, onToggleArtifact }: Readonly<ArtifactsSectionProps>) {
  return (
    <ContextPanelSectionFrame
      section="artifacts"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<span><i className="codicon codicon-file" /> Briefs & Summaries</span>}
      count={artifacts.length}
    >
      {loadingArtifacts ? (
        <div className="context-loading">Loading...</div>
      ) : allArtifacts.length === 0 ? (
        <div className="context-empty">
          No briefs created yet. Hover between messages and click "Summarize" to create one.
        </div>
      ) : (
        <div className="context-items">
          {allArtifacts.map((artifact) => (
            <button
              type="button"
              key={artifact.id}
              className={`context-item ${isInContext(artifacts, artifact.id) ? 'context-item-active' : ''}`}
              onClick={() => onToggleArtifact(artifact.id)}
            >
              <div className="context-item-header">
                <i className={`codicon codicon-${isInContext(artifacts, artifact.id) ? 'pinned' : 'circle-outline'} context-item-pin`} />
                <span className="context-item-title">{artifact.title}</span>
              </div>
              <div className="context-item-meta">
                <span className="context-item-date">{formatDate(artifact.createdAt)}</span>
                <span className="context-item-creator">by {artifact.createdBy}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </ContextPanelSectionFrame>
  );
}
