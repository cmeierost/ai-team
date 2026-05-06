import type { MouseEvent } from 'react';
import type { ChatSession, SessionActivatedTool, Task } from '../types';
import type { AgentToolPermissionEntry } from '@ai-team/api-contracts';
import type { SkillEntry } from '../hooks/useSkillsForAgent';
import {
  ContextWindowSection,
  FilesSection,
  NotesSection,
  SessionsSection,
  SkillsSection,
  TasksSection,
  ToolsSection,
  type ContextPanelNoteItem,
  type ContextSection,
} from './context-panel';
import './ContextPanel.css';

export type { ContextSection } from './context-panel';

export interface ContextPanelViewProps {
  agentId: string;
  sessionId?: string;
  toolEntries: AgentToolPermissionEntry[];
  sessions: ChatSession[];
  tasks: Task[];
  skillEntries: SkillEntry[];
  recentToolEvents: SessionActivatedTool[];
  activeToolNames: string[];
  notes: ContextPanelNoteItem[];
  notesLoading: boolean;
  sharingNoteId?: string | null;
  deletingNoteId?: string | null;
  hasSession: boolean;
  skillsLoading: boolean;
  skillsError: string | null;
  skillActionPending: string | null;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onSelectNote: (note: ContextPanelNoteItem) => void;
  onDeleteNote?: (note: ContextPanelNoteItem) => void;
  onNewNote: () => void;
  onToggleNoteHidden?: (note: ContextPanelNoteItem, hidden: boolean) => void;
  onToggleSkill: (skillName: string, assigned: boolean) => void;
  onSwitchSession?: (sessionId: string) => void;
  onDeleteSession: (event: MouseEvent, sessionId: string) => void;
  onCreateSession?: () => void;
  onOpenSessionGraph?: (sessionId: string) => void;
  onSuggestedHandoff?: (targetAgentId: string, task?: string) => void;
}

export function ContextPanelView({
  agentId,
  sessionId,
  toolEntries,
  sessions,
  tasks,
  skillEntries,
  recentToolEvents,
  activeToolNames,
  notes,
  notesLoading,
  sharingNoteId,
  deletingNoteId,
  hasSession,
  skillsLoading,
  skillsError,
  skillActionPending,
  expandedSection,
  onToggleSection,
  onSelectNote,
  onDeleteNote,
  onNewNote,
  onToggleNoteHidden,
  onToggleSkill,
  onSwitchSession,
  onDeleteSession,
  onCreateSession,
  onOpenSessionGraph,
  onSuggestedHandoff,
}: Readonly<ContextPanelViewProps>) {
  return (
    <div className="context-panel">
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

      <div className="context-panel-header">
        <h3>Context</h3>
      </div>

      <div className="context-sections">
        <ContextWindowSection
          agentId={agentId}
          sessionId={sessionId}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
        />

        <NotesSection
          notes={notes}
          hasSession={hasSession}
          notesLoading={notesLoading}
          sharingNoteId={sharingNoteId}
          deletingNoteId={deletingNoteId}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
          onSelectNote={onSelectNote}
          onDeleteNote={onDeleteNote}
          onToggleNoteHidden={onToggleNoteHidden}
          onNewNote={onNewNote}
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
          toolEntries={toolEntries}
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

        <FilesSection
          agentId={agentId}
          expandedSection={expandedSection}
          onToggleSection={onToggleSection}
        />
      </div>
    </div>
  );
}
