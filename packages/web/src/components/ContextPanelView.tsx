import type { MouseEvent } from 'react';
import type { Artifact, ChatSession, SessionActivatedTool, Task } from '../types';
import type { SkillEntry } from '../hooks/useSkillsForAgent';
import {
  ArtifactsSection,
  ContextWindowSection,
  FilesSection,
  NotesSection,
  SessionsSection,
  SkillsSection,
  TasksSection,
  ToolsSection,
  type ContextSection,
} from './context-panel';
import './ContextPanel.css';

export type { ContextSection } from './context-panel';

export interface ContextPanelViewProps {
  agentId: string;
  sessionId?: string;
  artifacts: string[];
  allowedTools: string[];
  allArtifacts: Artifact[];
  sessions: ChatSession[];
  tasks: Task[];
  skillEntries: SkillEntry[];
  recentToolEvents: SessionActivatedTool[];
  activeToolNames: string[];
  notesDraft: string;
  hasSession: boolean;
  savingNotes: boolean;
  notesError: string | null;
  skillsLoading: boolean;
  skillsError: string | null;
  skillActionPending: string | null;
  loadingArtifacts: boolean;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onNotesDraftChange: (value: string) => void;
  onSaveNotes: () => void;
  onToggleSkill: (skillName: string, assigned: boolean) => void;
  onToggleArtifact: (artifactId: string) => void;
  onSwitchSession?: (sessionId: string) => void;
  onDeleteSession: (event: MouseEvent, sessionId: string) => void;
  onCreateSession?: () => void;
  onOpenSessionGraph?: (sessionId: string) => void;
  onSuggestedHandoff?: (targetAgentId: string, task?: string) => void;
}

export function ContextPanelView({
  agentId,
  sessionId,
  artifacts,
  allowedTools,
  allArtifacts,
  sessions,
  tasks,
  skillEntries,
  recentToolEvents,
  activeToolNames,
  notesDraft,
  hasSession,
  savingNotes,
  notesError,
  skillsLoading,
  skillsError,
  skillActionPending,
  loadingArtifacts,
  expandedSection,
  onToggleSection,
  onNotesDraftChange,
  onSaveNotes,
  onToggleSkill,
  onToggleArtifact,
  onSwitchSession,
  onDeleteSession,
  onCreateSession,
  onOpenSessionGraph,
  onSuggestedHandoff,
}: Readonly<ContextPanelViewProps>) {
  return (
    <div className="context-panel">
      <div className="context-panel-header">
        <h3>Context</h3>
      </div>

      <div className="context-sections">
        <SessionsSection
          sessions={sessions}
          sessionId={sessionId}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
          onSwitchSession={onSwitchSession}
          onDeleteSession={onDeleteSession}
          onCreateSession={onCreateSession}
          onOpenSessionGraph={onOpenSessionGraph}
        />

        <ContextWindowSection
          agentId={agentId}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
        />

        <NotesSection
          notesDraft={notesDraft}
          hasSession={hasSession}
          savingNotes={savingNotes}
          notesError={notesError}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
          onNotesDraftChange={onNotesDraftChange}
          onSaveNotes={onSaveNotes}
        />

        <SkillsSection
          skillEntries={skillEntries}
          skillsLoading={skillsLoading}
          skillsError={skillsError}
          skillActionPending={skillActionPending}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
          onToggleSkill={onToggleSkill}
        />

        <ToolsSection
          allowedTools={allowedTools}
          recentToolEvents={recentToolEvents}
          activeToolNames={activeToolNames}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
          onSuggestedHandoff={onSuggestedHandoff}
        />

        <TasksSection
          tasks={tasks}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
        />

        <ArtifactsSection
          artifacts={artifacts}
          allArtifacts={allArtifacts}
          loadingArtifacts={loadingArtifacts}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
          onToggleArtifact={onToggleArtifact}
        />

        <FilesSection
          agentId={agentId}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
        />
      </div>
    </div>
  );
}