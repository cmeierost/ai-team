import type { Artifact } from '../../types';
import { formatDate } from '../../utils/contextPanel';
import { FileTree, type FileTreeCounts } from '../FileTree';
import { useState } from 'react';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';
import '../ContextPanel.css';

function isInContext(artifacts: string[], artifactId: string) {
  return artifacts.includes(artifactId);
}

interface ResourcesSectionProps {
  agentId: string;
  artifacts: string[];
  allArtifacts: Artifact[];
  loadingArtifacts: boolean;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onToggleArtifact: (artifactId: string) => void;
}

export function ResourcesSection({
  agentId,
  artifacts,
  allArtifacts,
  loadingArtifacts,
  expandedSection,
  onToggleSection,
  onToggleArtifact,
}: Readonly<ResourcesSectionProps>) {
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
      section="resources"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={
        <span>
          <i className="codicon codicon-files" /> Context Resources
        </span>
      }
      count={
        <span className="context-resources-counts">
          <span className="context-resources-artifact-count">{artifacts.length}</span>
          {countBadge}
        </span>
      }
      keepMounted
    >
      <div className="context-resources-layout">
        <section className="context-resources-group">
          <div className="context-resources-group-header">
            <h4>
              <i className="codicon codicon-note" /> Notes & Summaries
            </h4>
            <span className="context-section-count">{artifacts.length}</span>
          </div>
          {loadingArtifacts ? (
            <div className="context-loading">Loading...</div>
          ) : allArtifacts.length === 0 ? (
            <div className="context-empty">
              No notes or summaries yet. Hover between messages and click "Summarize" to create one.
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
                    <i
                      className={`codicon codicon-${isInContext(artifacts, artifact.id) ? 'pinned' : 'circle-outline'} context-item-pin`}
                    />
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
        </section>

        <section className="context-resources-group">
          <div className="context-resources-group-header">
            <h4>
              <i className="codicon codicon-attach" /> Files
            </h4>
            {countBadge ? countBadge : <span className="context-empty-inline">Loading access…</span>}
          </div>
          <div className="context-section-filetree context-resources-filetree">
            <FileTree agentId={agentId} editMode={false} onCountsChange={setCounts} />
          </div>
        </section>
      </div>
    </ContextPanelSectionFrame>
  );
}
