import { useState, useEffect } from 'react';
import { SessionActivatedTool } from '../types';
import { useArtifactsQuery } from '../hooks/useArtifactsQuery';
import { useSessionsForAgent } from '../hooks/useSessionsForAgent';
import { useSkillsForAgent } from '../hooks/useSkillsForAgent';
import { useTasksForAgent } from '../hooks/useTasksForAgent';
import { getActiveToolNames, stripSessionMetaNotes } from '../utils/contextPanel';
import { ContextPanelView, type ContextSection } from './ContextPanelView';

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
}

export function ContextPanel({ agentId, sessionId, artifacts, allowedTools, activatedTools, onToggleArtifact, onSwitchSession, onDeleteSession, onCreateSession, onOpenSessionGraph }: Readonly<ContextPanelProps>) {
  const [notesDraft, setNotesDraft] = useState('');
  const [expandedSection, setExpandedSection] = useState<ContextSection | null>('sessions');

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

  const saveNotes = async () => {
    if (!sessionId) return;
    try {
      await persistNotes(sessionId, notesDraft);
    } catch (error) {
      console.error('Failed to save notes:', error);
    }
  };

  const handleDeleteSession = async (e: React.MouseEvent, sessionIdToDelete: string) => {
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

  const recentToolEvents = [...activatedTools]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 12);

  const activeToolNames = getActiveToolNames(activatedTools);
  const hasSession = Boolean(sessionId);

  return (
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
    />
  );
}
