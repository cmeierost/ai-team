import type { SessionActivatedTool } from '../../types';
import {
  formatSessionTime,
  getToolPhaseClass,
  getToolPhaseLabel,
} from '../../utils/contextPanel';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';

interface ToolsSectionProps {
  allowedTools: string[];
  recentToolEvents: SessionActivatedTool[];
  activeToolNames: string[];
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
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

      <div className="context-tools-block">
        <div className="context-tools-subtitle">Activated (recent)</div>
        {recentToolEvents.length === 0 ? (
          <div className="context-empty">No tool activity yet in this session.</div>
        ) : (
          <div className="context-items">
            {recentToolEvents.map((event, index) => (
              <div key={`${event.toolName}-${event.timestamp}-${index}`} className="context-item context-tool-event">
                <div className="context-item-header">
                  <span className="context-item-title">{event.toolName}</span>
                  <span className={`context-tool-phase ${getToolPhaseClass(event.toolPhase)}`}>
                    {getToolPhaseLabel(event.toolPhase)}
                  </span>
                </div>
                <div className="context-item-meta">
                  <span className="context-item-date">{formatSessionTime(event.timestamp)}</span>
                  {event.message ? <span className="context-item-extra">{event.message}</span> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </ContextPanelSectionFrame>
  );
}
