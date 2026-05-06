import { useState, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { SessionActivatedTool } from '../types';
import type { AgentToolPermissionEntry } from '@ai-team/api-contracts';
import { useSessionsForAgent } from '../hooks/useSessionsForAgent';
import { useThreadNotes } from '../hooks/useThreadNotes';
import { useSkillsForAgent } from '../hooks/useSkillsForAgent';
import { useTasksForAgent } from '../hooks/useTasksForAgent';
import type { ContextPanelNoteItem } from '../utils/contextPanel';
import { getActiveToolNames } from '../utils/contextPanel';
import { ContextPanelView, type ContextSection } from './ContextPanelView';

const CONTEXT_PANEL_WIDTH_KEY = 'ai-team.context-panel.width';
const DEFAULT_CONTEXT_PANEL_WIDTH = 320;
const MIN_CONTEXT_PANEL_WIDTH = 260;
const MAX_CONTEXT_PANEL_WIDTH = 560;

function clampContextPanelWidth(width: number): number {
  return Math.min(MAX_CONTEXT_PANEL_WIDTH, Math.max(MIN_CONTEXT_PANEL_WIDTH, width));
}

function formatOwnedNoteLabel(title?: string): string {
  return title?.trim() || 'Untitled note';
}

function buildDeleteConfirmationMessage(
  transferableCount: number,
  unsharedTitles: string[]
): string {
  const messageParts = ['Delete this session? This cannot be undone.'];

  if (transferableCount > 0) {
    const transferSuffix = transferableCount === 1 ? '' : 's';
    messageParts.push(
      `${transferableCount} shared note${transferSuffix} will move to another shared session owner.`
    );
  }

  if (unsharedTitles.length > 0) {
    const unsharedSuffix = unsharedTitles.length === 1 ? '' : 's';
    const preview = unsharedTitles
      .slice(0, 3)
      .map((title) => `- ${title}`)
      .join('\n');
    let unsharedMessage = `${unsharedTitles.length} unshared note${unsharedSuffix} will be deleted if you continue.`;
    if (preview) {
      unsharedMessage += `\n${preview}`;
    }
    messageParts.push(unsharedMessage);
  }

  return messageParts.join('\n\n');
}

interface ContextPanelProps {
  agentId: string;
  sessionId?: string;
  toolEntries: AgentToolPermissionEntry[];
  activatedTools: SessionActivatedTool[];
  onSwitchSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onCreateSession?: () => void;
  onOpenSessionGraph?: (sessionId: string) => void;
  onOpenNote?: (noteId: string, options?: { sessionId?: string; agentId?: string }) => void;
  onNewNote?: () => void;
  onSuggestedHandoff?: (targetAgentId: string, task?: string) => void;
}

export function ContextPanel({
  agentId,
  sessionId,
  toolEntries,
  activatedTools,
  onSwitchSession,
  onDeleteSession,
  onCreateSession,
  onOpenSessionGraph,
  onOpenNote,
  onNewNote,
  onSuggestedHandoff,
}: Readonly<ContextPanelProps>) {
  const [expandedSection, setExpandedSection] = useState<ContextSection | null>(null);
  const [panelWidth, setPanelWidth] = useState(() => {
    if (globalThis.window === undefined) {
      return DEFAULT_CONTEXT_PANEL_WIDTH;
    }
    const storedWidth = globalThis.localStorage.getItem(CONTEXT_PANEL_WIDTH_KEY);
    const parsedWidth = storedWidth ? Number.parseInt(storedWidth, 10) : Number.NaN;
    return Number.isFinite(parsedWidth)
      ? clampContextPanelWidth(parsedWidth)
      : DEFAULT_CONTEXT_PANEL_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const { sessions, deleteSession: removeSession, getDeleteImpact } = useSessionsForAgent(agentId);
  const {
    notes,
    notesLoading,
    shareNoteToSession,
    sharingNoteId,
    toggleNoteHiddenFromLlm,
    deleteNoteFromThread,
    deletingNoteId,
  } = useThreadNotes(sessionId);
  const tasksQuery = useTasksForAgent(agentId);
  const { skillEntries, skillsLoading, skillsError, skillActionPending, toggleSkill } =
    useSkillsForAgent(agentId);

  const tasks = tasksQuery.data ?? [];

  useEffect(() => {
    shellRef.current?.style.setProperty('--context-panel-width', `${panelWidth}px`);
    if (globalThis.window !== undefined) {
      globalThis.localStorage.setItem(CONTEXT_PANEL_WIDTH_KEY, String(panelWidth));
    }
  }, [panelWidth]);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      const state = resizeStateRef.current;
      if (!state) {
        return;
      }

      const nextWidth = clampContextPanelWidth(state.startWidth + (state.startX - event.clientX));
      setPanelWidth(nextWidth);
    };

    const stopResizing = () => {
      resizeStateRef.current = null;
      setIsResizing(false);
      document.body.classList.remove('context-panel-resizing');
    };

    document.body.classList.add('context-panel-resizing');
    globalThis.addEventListener('mousemove', handleMouseMove);
    globalThis.addEventListener('mouseup', stopResizing);

    return () => {
      document.body.classList.remove('context-panel-resizing');
      globalThis.removeEventListener('mousemove', handleMouseMove);
      globalThis.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing]);

  const handleDeleteSession = async (e: MouseEvent, sessionIdToDelete: string) => {
    e.stopPropagation();

    try {
      const impact = await getDeleteImpact(sessionIdToDelete);
      const transferableCount = impact.transferableNotes.length;
      const unsharedTitles = impact.unsharedOwnedNotes.map((note) =>
        formatOwnedNoteLabel(note.title)
      );
      const confirmationMessage = buildDeleteConfirmationMessage(transferableCount, unsharedTitles);

      if (!globalThis.confirm(confirmationMessage)) {
        return;
      }

      await removeSession(sessionIdToDelete, {
        deleteUnsharedOwnedNotes: unsharedTitles.length > 0,
      });
      if (sessionIdToDelete === sessionId && onDeleteSession) {
        onDeleteSession(sessionIdToDelete);
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
      globalThis.alert('Failed to delete session. Please try again.');
    }
  };

  const toggleSection = (section: ContextSection) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const handleResizeStart = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();

    if (globalThis.innerWidth <= 900) {
      return;
    }

    resizeStateRef.current = {
      startX: event.clientX,
      startWidth: panelWidth,
    };
    setIsResizing(true);
  };

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const delta = event.key === 'ArrowLeft' ? 24 : -24;
    setPanelWidth((previous) => clampContextPanelWidth(previous + delta));
  };

  const recentToolEvents = activatedTools;
  const activeToolNames = getActiveToolNames(activatedTools);
  const hasSession = Boolean(sessionId);

  const handleSelectNote = async (note: ContextPanelNoteItem) => {
    if (note.canPullIntoCurrentSession) {
      try {
        await shareNoteToSession(note);
      } catch (error) {
        console.error('Failed to share note with current session:', error);
        globalThis.alert('Failed to pull the note into this session. Please try again.');
      }
      return;
    }

    onOpenNote?.(note.note.id, {
      sessionId: note.note.sessionId,
      agentId: note.note.agentId,
    });
  };

  return (
    <div ref={shellRef} className={`context-panel-shell${isResizing ? ' is-resizing' : ''}`}>
      {' '}
      <button
        type="button"
        className="context-panel-resize-handle"
        aria-label="Resize context panel"
        title="Drag to resize context panel"
        onMouseDown={handleResizeStart}
        onKeyDown={handleResizeKeyDown}
      />
      <ContextPanelView
        agentId={agentId}
        sessionId={sessionId}
        toolEntries={toolEntries}
        sessions={sessions}
        tasks={tasks}
        skillEntries={skillEntries}
        recentToolEvents={recentToolEvents}
        activeToolNames={activeToolNames}
        notes={notes}
        notesLoading={notesLoading}
        sharingNoteId={sharingNoteId}
        deletingNoteId={deletingNoteId}
        hasSession={hasSession}
        skillsLoading={skillsLoading}
        skillsError={skillsError}
        skillActionPending={skillActionPending}
        expandedSection={expandedSection}
        onToggleSection={toggleSection}
        onSelectNote={(note) => {
          void handleSelectNote(note);
        }}
        onDeleteNote={(noteItem) => {
          const label = noteItem.note.title?.trim() || 'this note';
          if (!globalThis.confirm(`Delete "${label}"?`)) {
            return;
          }
          deleteNoteFromThread(noteItem).catch((error) => {
            console.error('Failed to delete note:', error);
          });
        }}
        onNewNote={() => onNewNote?.()}
        onToggleNoteHidden={(noteItem, hidden) => {
          toggleNoteHiddenFromLlm({ noteItem, hidden }).catch((error) => {
            console.error('Failed to toggle note visibility:', error);
          });
        }}
        onToggleSkill={(skillName, assigned) => {
          toggleSkill(skillName, assigned).catch((error) => {
            console.error('Failed to update skill assignment:', error);
          });
        }}
        onSwitchSession={onSwitchSession}
        onDeleteSession={handleDeleteSession}
        onCreateSession={onCreateSession}
        onOpenSessionGraph={onOpenSessionGraph}
        onSuggestedHandoff={onSuggestedHandoff}
      />
    </div>
  );
}
