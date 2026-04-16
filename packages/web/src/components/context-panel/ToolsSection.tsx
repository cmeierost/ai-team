import type { AgentToolPermissionEntry } from '@ai-team/api-client';
import type { SessionActivatedTool } from '../../types';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';

interface ToolsSectionProps {
  toolEntries: AgentToolPermissionEntry[];
  recentToolEvents: SessionActivatedTool[];
  activeToolNames: string[];
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onSuggestedHandoff?: (targetAgentId: string, task?: string) => void;
}

function resolveToolName(event: SessionActivatedTool): string {
  return event.toolResult?.toolName || event.toolName;
}

function buildToolCallCounts(events: SessionActivatedTool[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const event of events) {
    // Count completed calls: result/error phases, or events with no phase (legacy stored data).
    // Skip start/request/denied phases — those don't represent a finished call.
    const phase = event.toolPhase;
    if (phase === 'start' || phase === 'request' || phase === 'denied') continue;
    const name = resolveToolName(event);
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return counts;
}

export function ToolsSection({
  toolEntries = [],
  recentToolEvents,
  activeToolNames,
  expandedSection,
  onToggleSection,
}: Readonly<ToolsSectionProps>) {
  const toolCallCounts = buildToolCallCounts(recentToolEvents);
  const usedToolCount = toolCallCounts.size;
  const totalAllowed = toolEntries.filter((e) => e.allowedForAgent !== false).length;
  let badge: string | number | undefined;
  if (usedToolCount > 0) {
    badge = `${usedToolCount}/${totalAllowed}`;
  } else if (totalAllowed > 0) {
    badge = totalAllowed;
  }

  // Build called entries from event keys so tools missing from toolEntries still appear
  const calledEntries = [...toolCallCounts.keys()]
    .map((name) => ({ name, entry: toolEntries.find((e) => e.name === name) }))
    .sort((a, b) => (toolCallCounts.get(b.name) ?? 0) - (toolCallCounts.get(a.name) ?? 0));

  const uncalledEntries = toolEntries.filter((e) => !toolCallCounts.has(e.name));

  return (
    <ContextPanelSectionFrame
      section="tools"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={
        <span>
          <i className="codicon codicon-tools" /> Tools
        </span>
      }
      count={badge}
    >
      <div className="context-tools-body">
        {calledEntries.length === 0 && toolEntries.length === 0 ? (
          <div className="context-empty">No tools are available for this agent.</div>
        ) : (
          <>
            {calledEntries.length > 0 && (
              <div className="context-tools-used">
                {calledEntries.map((item) => {
                  const count = toolCallCounts.get(item.name) ?? 0;
                  const isRunning = activeToolNames.includes(item.name);
                  return (
                    <div
                      key={item.name}
                      className={`context-tool-row${isRunning ? ' is-running' : ''}`}
                    >
                      <span className="context-tool-row-name">
                        {item.entry?.group ? (
                          <span className="context-tool-chip-group">{item.entry.group} ·</span>
                        ) : null}
                        {item.name}
                      </span>
                      <span className="context-tool-call-badge">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {uncalledEntries.length > 0 && (
              <div className="context-tool-chip-list">
                {uncalledEntries.map((entry) => {
                  const isRunning = activeToolNames.includes(entry.name);
                  const isFileGated = entry.fileRightsDependent === true;
                  const isDenied = entry.allowedForAgent === false;

                  let chipClass = 'context-tool-chip';
                  let tooltip: string | undefined;

                  if (isDenied) {
                    chipClass += ' is-denied';
                    tooltip = entry.deniedReason ?? 'Not allowed for this agent';
                  } else if (isFileGated) {
                    chipClass += ' is-file-gated';
                    tooltip = 'Access depends on agent file rights at runtime';
                  } else {
                    chipClass += ' is-allowed';
                  }

                  if (isRunning) chipClass += ' is-running';

                  return (
                    <span key={entry.name} className={chipClass} title={tooltip}>
                      {entry.group ? (
                        <span className="context-tool-chip-group">{entry.group} ·</span>
                      ) : null}
                      {entry.name}
                    </span>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </ContextPanelSectionFrame>
  );
}
