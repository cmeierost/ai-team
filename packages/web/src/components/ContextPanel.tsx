import { useState, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { SessionActivatedTool } from '../types';
import { useArtifactsQuery } from '../hooks/useArtifactsQuery';
import { useSessionsForAgent } from '../hooks/useSessionsForAgent';
import { useSkillsForAgent } from '../hooks/useSkillsForAgent';
import { useTasksForAgent } from '../hooks/useTasksForAgent';
import { getActiveToolNames, stripSessionMetaNotes } from '../utils/contextPanel';
import { ContextPanelView, type ContextSection } from './ContextPanelView';

const CONTEXT_PANEL_WIDTH_KEY = 'ai-team.context-panel.width';
const DEFAULT_CONTEXT_PANEL_WIDTH = 320;
const MIN_CONTEXT_PANEL_WIDTH = 260;
const MAX_CONTEXT_PANEL_WIDTH = 560;

function clampContextPanelWidth(width: number): number {
  return Math.min(MAX_CONTEXT_PANEL_WIDTH, Math.max(MIN_CONTEXT_PANEL_WIDTH, width));
}

interface ContextPanelProps {
  agentId: string;
  sessionId?: string;
  artifacts: string[]; // Artifact IDs in context
  allowedTools: string[];
  activatedTools: SessionActivatedTool[];
  onToggleArtifact: (artifactId: string) => void;
  onSwitchSession?: (sessionId: string) => void;
  onDeleteSession?: (sessionId: string) => void;
  onCreateSession?: () => void;
  onOpenSessionGraph?: (sessionId: string) => void;
  onSuggestedHandoff?: (targetAgentId: string, task?: string) => void;
}

export function ContextPanel({ agentId, sessionId, artifacts, allowedTools, activatedTools, onToggleArtifact, onSwitchSession, onDeleteSession, onCreateSession, onOpenSessionGraph, onSuggestedHandoff }: Readonly<ContextPanelProps>) {
  const [notesDraft, setNotesDraft] = useState('');
  const [expandedSection, setExpandedSection] = useState<ContextSection | null>('sessions');
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

  const artifactsQuery = useArtifactsQuery();
  const { sessions, saveNotes: persistNotes, savingNotes, notesError, deleteSession: removeSession } = useSessionsForAgent(agentId);
  const tasksQuery = useTasksForAgent(agentId);
  const { skillEntries, skillsLoading, skillsError, skillActionPending, toggleSkill } = useSkillsForAgent(agentId);

  const allArtifacts = artifactsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const loadingArtifacts = artifactsQuery.isLoading;

  const currentSession = sessions.find((s) => s.id === sessionId);

  useEffect(() => {
    setNotesDraft(stripSessionMetaNotes(currentSession?.notes));
  }, [sessionId, currentSession?.notes]);

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

  const saveNotes = async () => {
    if (!sessionId) return;
    try {
      await persistNotes(sessionId, notesDraft);
    } catch (error) {
      console.error('Failed to save notes:', error);
    }
  };

  const handleDeleteSession = async (e: MouseEvent, sessionIdToDelete: string) => {
    e.stopPropagation();

    if (!globalThis.confirm('Delete this session? This cannot be undone.')) {
      return;
    }

    try {
      await removeSession(sessionIdToDelete);
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

  const recentToolEvents = [...activatedTools]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 12);

  const activeToolNames = getActiveToolNames(activatedTools);
  const hasSession = Boolean(sessionId);

  return (
    <div ref={shellRef} className={`context-panel-shell${isResizing ? ' is-resizing' : ''}`}>
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
        artifacts={artifacts}
        allowedTools={allowedTools}
        allArtifacts={allArtifacts}
        sessions={sessions}
        tasks={tasks}
        skillEntries={skillEntries}
        recentToolEvents={recentToolEvents}
        activeToolNames={activeToolNames}
        notesDraft={notesDraft}
        hasSession={hasSession}
        savingNotes={savingNotes}
        notesError={notesError}
        skillsLoading={skillsLoading}
        skillsError={skillsError}
        skillActionPending={skillActionPending}
        loadingArtifacts={loadingArtifacts}
        expandedSection={expandedSection}
        onToggleSection={toggleSection}
        onNotesDraftChange={setNotesDraft}
        onSaveNotes={saveNotes}
        onToggleSkill={(skillName, assigned) => {
          toggleSkill(skillName, assigned).catch((error) => {
            console.error('Failed to update skill assignment:', error);
          });
        }}
        onToggleArtifact={onToggleArtifact}
        onSwitchSession={onSwitchSession}
        onDeleteSession={handleDeleteSession}
        onCreateSession={onCreateSession}
        onOpenSessionGraph={onOpenSessionGraph}
        onSuggestedHandoff={onSuggestedHandoff}
      />
    </div>
  );
}
