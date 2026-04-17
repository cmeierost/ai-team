import type {
  ChatSession,
  Note,
  SessionActivatedTool,
  SessionNode,
  SessionThread,
  TaskPriority,
  TaskStatus,
} from '../types';

const SESSION_META_PREFIX = '<!-- ai-team:session-meta ';

export function stripSessionMetaNotes(raw?: string): string {
  if (!raw) return '';
  const idx = raw.lastIndexOf(SESSION_META_PREFIX);
  if (idx < 0) return raw;
  return raw.slice(0, idx).trimEnd();
}

export function getToolPhaseLabel(phase?: SessionActivatedTool['toolPhase']): string {
  switch (phase) {
    case 'request':
      return 'Requested';
    case 'start':
      return 'Running';
    case 'result':
      return 'Completed';
    case 'error':
      return 'Error';
    case 'denied':
      return 'Denied';
    default:
      return 'Observed';
  }
}

export function getToolPhaseClass(phase?: SessionActivatedTool['toolPhase']): string {
  switch (phase) {
    case 'request':
    case 'start':
      return 'running';
    case 'result':
      return 'completed';
    case 'error':
    case 'denied':
      return 'failed';
    default:
      return 'neutral';
  }
}

export function getActiveToolNames(activatedTools: SessionActivatedTool[]): string[] {
  const latestByTool = new Map<string, SessionActivatedTool>();
  for (const event of activatedTools) {
    const identity = event.toolResult?.toolName || event.toolName;
    const prev = latestByTool.get(identity);
    if (!prev || new Date(event.timestamp).getTime() >= new Date(prev.timestamp).getTime()) {
      latestByTool.set(identity, event);
    }
  }

  return Array.from(latestByTool.values())
    .filter((entry) => entry.toolPhase === 'request' || entry.toolPhase === 'start')
    .map((entry) => entry.toolResult?.toolName || entry.toolName)
    .sort((a, b) => a.localeCompare(b));
}

export function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatSessionTime(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function getSessionTitle(session: ChatSession): string {
  if (session.title) return session.title;
  const date = new Date(session.startedAt);
  return `Session ${date.toLocaleDateString()} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export interface ContextPanelNoteItem {
  note: Note;
  ownerSession: SessionNode;
  isOwnedByCurrentSession: boolean;
  isSharedWithCurrentSession: boolean;
  canPullIntoCurrentSession: boolean;
}

export function buildThreadContextNotes(
  thread: SessionThread,
  notesBySessionId: Record<string, Note[]>,
  currentSessionId: string,
  sharedNoteIdsInCurrentSession?: ReadonlySet<string>
): ContextPanelNoteItem[] {
  const sessionMap = new Map(thread.sessions.map((session) => [session.sessionId, session]));
  const notes = new Map<string, ContextPanelNoteItem>();

  for (const [ownerSessionId, sessionNotes] of Object.entries(notesBySessionId)) {
    const ownerSession = sessionMap.get(ownerSessionId);
    if (!ownerSession) {
      continue;
    }

    for (const note of sessionNotes) {
      const resolvedOwnerSessionId = note.sessionId ?? ownerSessionId;
      const resolvedOwnerSession = sessionMap.get(resolvedOwnerSessionId) ?? ownerSession;
      const sharedSessionIds = note.sharedSessionIds ?? [];
      const isOwnedByCurrentSession = resolvedOwnerSession.sessionId === currentSessionId;
      const isSharedWithCurrentSession = sharedNoteIdsInCurrentSession
        ? sharedNoteIdsInCurrentSession.has(note.id)
        : sharedSessionIds.includes(currentSessionId);

      notes.set(note.id, {
        note: {
          ...note,
          sessionId: resolvedOwnerSession.sessionId,
        },
        ownerSession: resolvedOwnerSession,
        isOwnedByCurrentSession,
        isSharedWithCurrentSession,
        canPullIntoCurrentSession: !isOwnedByCurrentSession && !isSharedWithCurrentSession,
      });
    }
  }

  return Array.from(notes.values()).sort((left, right) => {
    const updatedDiff =
      new Date(right.note.updatedAt).getTime() - new Date(left.note.updatedAt).getTime();
    if (updatedDiff !== 0) {
      return updatedDiff;
    }
    return left.note.id.localeCompare(right.note.id);
  });
}

export function getTaskStatusIcon(status: TaskStatus): string {
  switch (status) {
    case 'not_started':
      return 'circle-outline';
    case 'in_progress':
      return 'loading';
    case 'blocked':
      return 'error';
    case 'waiting_approval':
      return 'watch';
    case 'completed':
      return 'pass';
    case 'cancelled':
      return 'close';
    case 'delegated':
      return 'arrow-small-right';
    default:
      return 'circle-outline';
  }
}

export function getTaskPriorityClass(priority: TaskPriority): string {
  switch (priority) {
    case 'urgent':
      return 'priority-urgent';
    case 'high':
      return 'priority-high';
    case 'medium':
      return 'priority-medium';
    case 'low':
      return 'priority-low';
    default:
      return '';
  }
}
