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
  onSuggestedHandoff?: (targetAgentId: string, task?: string) => void;
}

interface FileTreeNodeLike {
  name?: string;
  isDirectory?: boolean;
  children?: FileTreeNodeLike[];
}

interface FileTreeToolResultLike {
  path?: string;
  tree?: FileTreeNodeLike | null;
}

interface WhoShouldMatch {
  agentId: string;
  agentName: string;
  agentRole: string;
}

interface WhoShouldResultLike {
  type: 'fs_who_should_result';
  task?: string;
  matches?: WhoShouldMatch[];
}

interface QuestionToolPayloadLike {
  request?: {
    question?: string;
    questionType?: string;
    choices?: Array<{ name: string; value: string }>;
    allowOther?: boolean;
  };
  response?: {
    question?: string;
    questionType?: string;
    answer?: unknown;
  };
  error?: string;
}

function resolveToolName(event: SessionActivatedTool): string {
  return event.toolResult?.toolName || event.toolName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toPayloadRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return parseJsonObject(value);
  }
  return null;
}

function asFileTreeResult(value: unknown): FileTreeToolResultLike | null {
  const payload = toPayloadRecord(value);
  if (!payload) return null;
  return 'tree' in payload
    ? (payload as FileTreeToolResultLike)
    : null;
}

function asWhoShouldResult(value: unknown): WhoShouldResultLike | null {
  const payload = toPayloadRecord(value);
  if (!payload) return null;
  const type = payload.type;
  if (type !== 'fs_who_should_result') return null;
  return payload as unknown as WhoShouldResultLike;
}

function asQuestionToolPayload(value: unknown): QuestionToolPayloadLike | null {
  const payload = toPayloadRecord(value);
  if (!payload) return null;

  const hasRequest = 'request' in payload && isRecord(payload.request);
  const hasResponse = 'response' in payload && isRecord(payload.response);
  const hasError = typeof payload.error === 'string';
  if (!hasRequest && !hasResponse && !hasError) {
    return null;
  }

  return payload as QuestionToolPayloadLike;
}

function formatAnswerPreview(answer: unknown): string {
  if (answer === undefined) return 'No answer captured.';
  if (Array.isArray(answer)) {
    return answer.length ? answer.map(String).join(', ') : 'No selection.';
  }
  if (typeof answer === 'boolean') return answer ? 'Yes' : 'No';
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number' || typeof answer === 'bigint') return `${answer}`;
  if (typeof answer === 'object') {
    try {
      return JSON.stringify(answer);
    } catch {
      return 'Complex answer value';
    }
  }
  try {
    return JSON.stringify(answer);
  } catch {
    return 'Complex answer value';
  }
}

function countTreeNodes(node?: FileTreeNodeLike | null): { files: number; directories: number } {
  if (!node) return { files: 0, directories: 0 };
  let files = node.isDirectory ? 0 : 1;
  let directories = node.isDirectory ? 1 : 0;
  for (const child of node.children ?? []) {
    const nested = countTreeNodes(child);
    files += nested.files;
    directories += nested.directories;
  }
  return { files, directories };
}

function getTopTreeEntries(node?: FileTreeNodeLike | null, max = 6): string[] {
  if (!node?.children?.length) return [];
  return node.children
    .slice(0, max)
    .map((child) => `${child.isDirectory ? '📁' : '📄'} ${child.name ?? 'untitled'}`);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function ToolsSection({ allowedTools, recentToolEvents, activeToolNames, expandedSection, onToggleSection, onSuggestedHandoff }: Readonly<ToolsSectionProps>) {
  const renderToolMeta = (event: SessionActivatedTool) => {
    const denial = event.toolDenial ?? event.toolResult?.denial;
    if (!denial) {
      return event.message ? <span className="context-item-extra">{event.message}</span> : null;
    }

    const blocked = denial.blockedPaths?.length ?? 0;
    const alternatives = denial.alternativeContexts?.length ?? 0;
    const summaryBits: string[] = [denial.message, `reason: ${denial.reasonCode}`];
    if (blocked > 0) summaryBits.push(`blocked paths: ${blocked}`);
    if (alternatives > 0) summaryBits.push(`alternative contexts: ${alternatives}`);

    return (
      <span className="context-item-extra">
        {summaryBits.join(' · ')}
      </span>
    );
  };

  const renderStructuredCard = (event: SessionActivatedTool) => {
    const payload = event.toolResult?.result;
    const questionPayload = asQuestionToolPayload(payload);
    if (questionPayload && resolveToolName(event) === 'com_ask') {
      const requestQuestion = questionPayload.request?.question;
      const responseQuestion = questionPayload.response?.question;
      const prompt = requestQuestion ?? responseQuestion ?? 'Question prompt unavailable.';
      const questionType = questionPayload.request?.questionType ?? questionPayload.response?.questionType ?? 'input';
      const choicesCount = questionPayload.request?.choices?.length ?? 0;

      return (
        <div className="context-tool-rich-card" role="group" aria-label="Question tool result">
          <div className="context-tool-rich-title">Question prompt</div>
          <div className="context-tool-rich-summary">{prompt}</div>
          <div className="context-tool-rich-summary">
            type: {questionType}{choicesCount > 0 ? ` · choices: ${choicesCount}` : ''}
          </div>
          {questionPayload.error ? (
            <div className="context-tool-rich-empty">{questionPayload.error}</div>
          ) : (
            <div className="context-tool-rich-summary">
              answer: {formatAnswerPreview(questionPayload.response?.answer)}
            </div>
          )}
        </div>
      );
    }

    const whoShould = asWhoShouldResult(payload);

    if (whoShould) {
      const matches = Array.isArray(whoShould.matches) ? whoShould.matches : [];
      return (
        <div className="context-tool-rich-card" role="group" aria-label="Who should handle this task">
          <div className="context-tool-rich-title">Suggested handoff targets</div>
          {matches.length === 0 ? (
            <div className="context-tool-rich-empty">No matching teammate was found for this request.</div>
          ) : (
            <div className="context-tool-target-list">
              {matches.slice(0, 4).map((match) => (
                <div key={match.agentId} className="context-tool-target-item">
                  <span className="context-tool-target-avatar" aria-hidden="true">{getInitials(match.agentName)}</span>
                  <div className="context-tool-target-content">
                    <span className="context-tool-target-name">{match.agentName}</span>
                    <span className="context-tool-target-role">{match.agentRole}</span>
                  </div>
                  <button
                    type="button"
                    className="context-tool-target-handoff"
                    onClick={() => onSuggestedHandoff?.(match.agentId, whoShould.task)}
                    disabled={!onSuggestedHandoff}
                    title={`Hand off to ${match.agentName}`}
                  >
                    handoff
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    const treeResult = asFileTreeResult(payload);
    if (treeResult?.tree) {
      const counts = countTreeNodes(treeResult.tree);
      const entries = getTopTreeEntries(treeResult.tree);
      return (
        <div className="context-tool-rich-card" role="group" aria-label="File tree result">
          <div className="context-tool-rich-title">File tree snapshot</div>
          <div className="context-tool-rich-summary">
            {treeResult.path ?? '.'} · {counts.directories} dirs · {counts.files} files
          </div>
          {entries.length > 0 ? (
            <div className="context-tool-tree-preview">
              {entries.map((entry) => (
                <span key={entry} className="context-tool-tree-entry">{entry}</span>
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    return null;
  };

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
              <div key={`${resolveToolName(event)}-${event.timestamp}-${index}`} className="context-item context-tool-event">
                <div className="context-item-header">
                  <span className="context-item-title">{resolveToolName(event)}</span>
                  <span className={`context-tool-phase ${getToolPhaseClass(event.toolPhase)}`}>
                    {getToolPhaseLabel(event.toolPhase)}
                  </span>
                </div>
                <div className="context-item-meta">
                  <span className="context-item-date">{formatSessionTime(event.timestamp)}</span>
                  {renderToolMeta(event)}
                </div>
                {renderStructuredCard(event)}
              </div>
            ))}
          </div>
        )}
      </div>
    </ContextPanelSectionFrame>
  );
}
