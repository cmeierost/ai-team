import type { SessionActivatedTool } from '../../types';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';

interface ToolsSectionProps {
  allowedTools: string[];
  recentToolEvents: SessionActivatedTool[];
  activeToolNames: string[];
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onSuggestedHandoff?: (targetAgentId: string, task?: string) => void;
}

function resolveToolName(event: SessionActivatedTool): string {
  return event.toolResult?.toolName || event.toolName;
}

export function ToolsSection({ allowedTools, recentToolEvents, activeToolNames, expandedSection, onToggleSection }: Readonly<ToolsSectionProps>) {
  return (
    <ContextPanelSectionFrame
      section="tools"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<span><i className="codicon codicon-tools" /> Tools</span>}
      count={`${activeToolNames.length}/${allowedTools.length}`}
    >
      <div className="context-tools-block">
        <div className="context-tools-subtitle">Allowed</div>
        {allowedTools.length === 0 ? (
          <div className="context-empty">No tools are currently allowed for this agent.</div>
        ) : (
          <div className="context-tool-chip-list">
            {allowedTools.map((toolName) => (
              <span key={toolName} className={`context-tool-chip ${activeToolNames.includes(toolName) ? 'is-active' : ''}`}>
                {toolName}
              </span>
            ))}
          </div>
        )}
      </div>

      {recentToolEvents.length > 0 && (
        <div className="context-tools-block">
          <div className="context-tools-subtitle">
            {recentToolEvents.length} tool call{recentToolEvents.length !== 1 ? 's' : ''} this session
          </div>
          <div className="context-tool-chip-list">
            {[...new Set(recentToolEvents.map(resolveToolName))].map((name) => (
              <span key={name} className="context-tool-chip is-active">{name}</span>
            ))}
          </div>
        </div>
      )}
    </ContextPanelSectionFrame>
  );
}
