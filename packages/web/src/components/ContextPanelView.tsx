import type { MouseEvent, ReactNode } from 'react';
import type { Artifact, ChatSession, SessionActivatedTool, Task } from '../types';
import type { SkillEntry } from '../hooks/useSkillsForAgent';
import {
  formatDate,
  formatSessionTime,
  getSessionTitle,
  getTaskPriorityClass,
  getTaskStatusIcon,
  getToolPhaseClass,
  getToolPhaseLabel,
} from '../utils/contextPanel';
import { FileTree } from './FileTree';
import './ContextPanel.css';

export type ContextSection = 'sessions' | 'notes' | 'skills' | 'tools' | 'tasks' | 'artifacts' | 'files';

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
  onDeleteSession: (event: React.MouseEvent, sessionId: string) => void;
  onCreateSession?: () => void;
  onOpenSessionGraph?: (sessionId: string) => void;
}

function isInContext(artifacts: string[], artifactId: string) {
  return artifacts.includes(artifactId);
}

interface SectionFrameProps {
  section: ContextSection;
  expandedSection: ContextSection | null;
  title: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
  onToggleSection: (section: ContextSection) => void;
  children: ReactNode;
}

function SectionFrame({ section, expandedSection, title, count, action, onToggleSection, children }: Readonly<SectionFrameProps>) {
  const isExpanded = expandedSection === section;

  return (
    <div className="context-section">
      <div className="context-section-header-wrapper">
        <button
          className={`context-section-header ${isExpanded ? 'expanded' : ''}`}
          onClick={() => onToggleSection(section)}
        >
          <i className={`codicon codicon-chevron-${isExpanded ? 'down' : 'right'}`} />
          <span className="context-section-title">{title}</span>
          {count === undefined ? null : <span className="context-section-count">{count}</span>}
        </button>
        {action}
      </div>

      {isExpanded ? <div className="context-section-content">{children}</div> : null}
    </div>
  );
}

interface SessionsSectionProps {
  sessions: ChatSession[];
  sessionId?: string;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onSwitchSession?: (sessionId: string) => void;
  onDeleteSession: (event: MouseEvent, sessionId: string) => void;
  onCreateSession?: () => void;
  onOpenSessionGraph?: (sessionId: string) => void;
}

function SessionsSection({ sessions, sessionId, expandedSection, onToggleSection, onSwitchSession, onDeleteSession, onCreateSession, onOpenSessionGraph }: Readonly<SessionsSectionProps>) {
  return (
    <SectionFrame
      section="sessions"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<><i className="codicon codicon-comment-discussion" /> Session</>}
      count={sessions.length}
      action={onCreateSession ? (
        <button
          className="context-section-action"
          onClick={onCreateSession}
          title="Create new session"
        >
          <i className="codicon codicon-add" />
        </button>
      ) : null}
    >
      {sessions.length === 0 ? (
        <div className="context-empty">No previous sessions. Start chatting to create a new session.</div>
      ) : (
        <div className="context-items">
          {sessions.map((session) => (
            <div key={session.id} className={`context-item ${session.id === sessionId ? 'context-item-current' : ''}`}>
              <div className="context-item-header">
                <button type="button" className="context-item-link" onClick={() => onSwitchSession?.(session.id)}>
                  <i className={`codicon codicon-${session.id === sessionId ? 'circle-filled' : 'circle-outline'} context-item-pin`} />
                  <span className="context-item-title">{getSessionTitle(session)}</span>
                </button>
                <button
                  className="context-item-action"
                  onClick={(event) => onDeleteSession(event, session.id)}
                  title="Delete session"
                >
                  <i className="codicon codicon-trash" />
                </button>
                {onOpenSessionGraph ? (
                  <button
                    className="context-item-action"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSessionGraph(session.id);
                    }}
                    title="View session thread graph"
                  >
                    <i className="codicon codicon-git-branch" />
                  </button>
                ) : null}
              </div>
              <div className="context-item-meta">
                <span className="context-item-date">{formatSessionTime(session.lastActivityAt)}</span>
                {session.artifacts && session.artifacts.length > 0 ? (
                  <span className="context-item-extra">
                    {session.artifacts.length} brief{session.artifacts.length > 1 ? 's' : ''}
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionFrame>
  );
}

interface NotesSectionProps {
  notesDraft: string;
  hasSession: boolean;
  savingNotes: boolean;
  notesError: string | null;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onNotesDraftChange: (value: string) => void;
  onSaveNotes: () => void;
}

function NotesSection({ notesDraft, hasSession, savingNotes, notesError, expandedSection, onToggleSection, onNotesDraftChange, onSaveNotes }: Readonly<NotesSectionProps>) {
  return (
    <SectionFrame
      section="notes"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<><i className="codicon codicon-note" /> Notes</>}
      count={notesDraft.trim().length > 0 ? 1 : 0}
    >
      {hasSession ? (
        <div className="context-notes-wrap">
          <textarea
            className="context-notes-input"
            value={notesDraft}
            onChange={(event) => onNotesDraftChange(event.target.value)}
            placeholder="Write session notes here..."
            rows={5}
          />
          <div className="context-notes-actions">
            <button type="button" className="context-notes-save" onClick={onSaveNotes} disabled={savingNotes}>
              {savingNotes ? 'Saving…' : 'Save notes'}
            </button>
            {notesError ? <span className="context-notes-error">{notesError}</span> : null}
          </div>
        </div>
      ) : (
        <div className="context-empty">Start or open a session to keep notes.</div>
      )}
    </SectionFrame>
  );
}

interface SkillsSectionProps {
  skillEntries: SkillEntry[];
  skillsLoading: boolean;
  skillsError: string | null;
  skillActionPending: string | null;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onToggleSkill: (skillName: string, assigned: boolean) => void;
}

function SkillsSection({ skillEntries, skillsLoading, skillsError, skillActionPending, expandedSection, onToggleSection, onToggleSkill }: Readonly<SkillsSectionProps>) {
  return (
    <SectionFrame
      section="skills"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<><i className="codicon codicon-library" /> Skills</>}
      count={skillEntries.filter((entry) => entry.assignedToAgent).length}
    >
      {skillsLoading ? (
        <div className="context-loading">Loading skills...</div>
      ) : skillEntries.length === 0 ? (
        <div className="context-empty">No skills available.</div>
      ) : (
        <div className="context-items">
          {skillEntries.map((entry) => {
            const assigned = entry.assignedToAgent === true;
            const pending = skillActionPending === entry.name;
            return (
              <div key={entry.name} className={`context-item ${assigned ? 'context-item-active' : ''}`}>
                <div className="context-item-header">
                  <span className="context-item-title">{entry.name}</span>
                  <button
                    className="context-item-action context-skill-action"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleSkill(entry.name, assigned);
                    }}
                    disabled={pending || !!skillActionPending}
                    title={assigned ? 'Remove skill' : 'Assign skill'}
                  >
                    {pending ? '…' : assigned ? '−' : '+'}
                  </button>
                </div>
                {entry.description ? (
                  <div className="context-item-meta">
                    <span className="context-item-extra">{entry.description}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {skillsError ? <div className="context-empty context-skills-error">{skillsError}</div> : null}
    </SectionFrame>
  );
}

interface ToolsSectionProps {
  allowedTools: string[];
  recentToolEvents: SessionActivatedTool[];
  activeToolNames: string[];
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
}

function ToolsSection({ allowedTools, recentToolEvents, activeToolNames, expandedSection, onToggleSection }: Readonly<ToolsSectionProps>) {
  return (
    <SectionFrame
      section="tools"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<><i className="codicon codicon-tools" /> Tools</>}
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
    </SectionFrame>
  );
}

interface TasksSectionProps {
  tasks: Task[];
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
}

function TasksSection({ tasks, expandedSection, onToggleSection }: Readonly<TasksSectionProps>) {
  return (
    <SectionFrame
      section="tasks"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<><i className="codicon codicon-checklist" /> Tasks</>}
      count={tasks.length}
    >
      {tasks.length === 0 ? (
        <div className="context-empty">No tasks assigned yet.</div>
      ) : (
        <div className="context-items">
          {tasks.map((task) => (
            <div key={task.id} className={`context-item context-task ${getTaskPriorityClass(task.priority)}`}>
              <div className="context-item-header">
                <i className={`codicon codicon-${getTaskStatusIcon(task.status)} context-item-pin task-status-icon`} />
                <span className="context-item-title">{task.title}</span>
              </div>
              <div className="context-item-meta">
                <span className="task-priority">{task.priority}</span>
                {task.dueDate ? <span className="task-due-date">Due {formatDate(task.dueDate)}</span> : null}
              </div>
              {task.subtaskIds && task.subtaskIds.length > 0 ? (
                <div className="task-subtasks">
                  {task.subtaskIds.length} subtask{task.subtaskIds.length > 1 ? 's' : ''}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </SectionFrame>
  );
}

interface ArtifactsSectionProps {
  artifacts: string[];
  allArtifacts: Artifact[];
  loadingArtifacts: boolean;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onToggleArtifact: (artifactId: string) => void;
}

function ArtifactsSection({ artifacts, allArtifacts, loadingArtifacts, expandedSection, onToggleSection, onToggleArtifact }: Readonly<ArtifactsSectionProps>) {
  return (
    <SectionFrame
      section="artifacts"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<><i className="codicon codicon-file" /> Briefs & Summaries</>}
      count={artifacts.length}
    >
      {loadingArtifacts ? (
        <div className="context-loading">Loading...</div>
      ) : allArtifacts.length === 0 ? (
        <div className="context-empty">
          No briefs created yet. Hover between messages and click "Summarize" to create one.
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
                <i className={`codicon codicon-${isInContext(artifacts, artifact.id) ? 'pinned' : 'circle-outline'} context-item-pin`} />
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
    </SectionFrame>
  );
}

interface FilesSectionProps {
  agentId: string;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
}

function FilesSection({ agentId, expandedSection, onToggleSection }: Readonly<FilesSectionProps>) {
  return (
    <SectionFrame
      section="files"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<><i className="codicon codicon-folder" /> Accessible Files</>}
    >
      <div className="context-section-filetree">
        <FileTree agentId={agentId} editMode={false} />
      </div>
    </SectionFrame>
  );
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